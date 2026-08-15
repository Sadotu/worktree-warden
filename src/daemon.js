import { resolvePrimaryWorkspace, resolveRepoSlug, resolveStateDir, resolveCleanupScriptPath } from './repo.js';
import { discoverAgentWorktrees } from './discovery.js';
import { mintToken, findPullRequestForBranch } from './github.js';
import { runCleanup, classifyAfterRetries } from './cleanup.js';
import { loadStore, saveStore, getBranchState, setBranchState, clearBranchState } from './store.js';
import { appendLog } from './log.js';

const DEFAULT_MAX_RETRIES = 5;

export function runOnce(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const primaryWorkspace = options.primaryWorkspace ?? resolvePrimaryWorkspace(cwd);
  const repoSlug = options.repoSlug ?? resolveRepoSlug(cwd);
  const stateDir = options.stateDir ?? resolveStateDir(cwd);
  const cleanupScript = options.cleanupScript ?? resolveCleanupScriptPath(primaryWorkspace);
  const maxRetries = options.maxRetries ?? (Number(process.env.WARDEN_MAX_CONSECUTIVE_RETRIES) || DEFAULT_MAX_RETRIES);
  const discover = options.discover ?? (() => discoverAgentWorktrees(primaryWorkspace));
  const mint = options.mint ?? (() => mintToken(repoSlug));
  const findPR = options.findPR ?? ((branch, token) => findPullRequestForBranch(repoSlug, branch, token));
  const cleanup = options.cleanup ?? ((pr, issue) => runCleanup(cleanupScript, pr, issue));
  const log = options.log ?? ((level, message) => appendLog(stateDir, level, message));

  let store = loadStore(stateDir);
  const worktrees = discover();
  const seen = new Set();

  for (const wt of worktrees) {
    seen.add(wt.branch);
    const branchState = getBranchState(store, wt.branch);
    if (branchState.outcome === 'blocked' || branchState.outcome === 'cleaned') continue;

    let token;
    try {
      token = mint();
    } catch (err) {
      const newRetryCount = branchState.retryKind === 'connectivity' ? branchState.retryCount + 1 : 1;
      const outcome = classifyAfterRetries('retry', newRetryCount, maxRetries);
      log(outcome === 'blocked' ? 'error' : 'warn', `${wt.branch}: token mint failed: ${err.message}`);
      store = setBranchState(store, wt.branch, {
        outcome,
        retryCount: newRetryCount,
        retryKind: 'connectivity',
        attention: outcome === 'blocked',
      });
      continue;
    }

    let pr;
    try {
      pr = findPR(wt.branch, token);
    } catch (err) {
      const newRetryCount = branchState.retryKind === 'connectivity' ? branchState.retryCount + 1 : 1;
      const outcome = classifyAfterRetries('retry', newRetryCount, maxRetries);
      log(outcome === 'blocked' ? 'error' : 'warn', `${wt.branch}: PR lookup failed: ${err.message}`);
      store = setBranchState(store, wt.branch, {
        outcome,
        retryCount: newRetryCount,
        retryKind: 'connectivity',
        attention: outcome === 'blocked',
      });
      continue;
    }

    if (!pr || pr.state === 'OPEN') {
      store = setBranchState(store, wt.branch, { outcome: 'waiting', retryCount: 0 });
      continue;
    }
    if (pr.state === 'CLOSED') {
      store = clearBranchState(store, wt.branch);
      continue;
    }

    // MERGED
    const result = cleanup(pr.number, wt.issueNumber);
    if (result.outcome === 'cleaned') {
      log('info', `${wt.branch}: cleaned (pr #${pr.number})`);
      store = clearBranchState(store, wt.branch);
      continue;
    }
    const nextRetryCount = branchState.retryKind === 'cleanup' ? branchState.retryCount + 1 : 1;
    const finalOutcome = classifyAfterRetries(result.outcome, nextRetryCount, maxRetries);
    log(
      finalOutcome === 'blocked' ? 'error' : 'warn',
      `${wt.branch}: ${finalOutcome} (pr #${pr.number}): ${result.stderr.trim()}`
    );
    store = setBranchState(store, wt.branch, {
      outcome: finalOutcome,
      retryCount: nextRetryCount,
      retryKind: 'cleanup',
      attention: finalOutcome === 'blocked',
    });
  }

  for (const branch of Object.keys(store)) {
    if (seen.has(branch)) continue;
    const priorState = getBranchState(store, branch);
    if (priorState.outcome === 'retry' || priorState.outcome === 'blocked') {
      log('warn', `${branch}: disappeared from discovery while outcome was '${priorState.outcome}' — verify main/issue manually`);
    }
    store = clearBranchState(store, branch);
  }

  saveStore(stateDir, store);
  return store;
}

export function loop(options = {}) {
  const intervalMs = options.intervalMs ?? (Number(process.env.WARDEN_POLL_INTERVAL_MS) || 60000);
  const stateDir = options.stateDir ?? resolveStateDir(options.cwd ?? process.cwd());
  let stopped = false;
  let timer = null;

  const tick = () => {
    if (stopped) return;
    try {
      runOnce(options);
    } catch (err) {
      appendLog(stateDir, 'error', `runOnce failed: ${err.message}`);
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };

  tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
