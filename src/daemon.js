import { resolvePrimaryWorkspace, resolveRepoSlug, resolveStateDir, resolveCleanupScriptPath } from './repo.js';
import { discoverAgentWorktrees } from './discovery.js';
import { mintToken, findPullRequestForBranch } from './github.js';
import { invokeCleanup } from './cleanup.js';
import { loadStore, saveStore, getCandidate, setPending, setAttention, clearCandidate } from './store.js';
import { appendLog } from './log.js';

export function runOnce(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const primaryWorkspace = options.primaryWorkspace ?? resolvePrimaryWorkspace(cwd);
  const repoSlug = options.repoSlug ?? resolveRepoSlug(cwd);
  const stateDir = options.stateDir ?? resolveStateDir(cwd);
  const cleanupScript = options.cleanupScript ?? resolveCleanupScriptPath(primaryWorkspace);
  const discover = options.discover ?? (() => discoverAgentWorktrees(primaryWorkspace));
  const mint = options.mint ?? (() => mintToken(repoSlug));
  const findPR = options.findPR ?? ((branch, token) => findPullRequestForBranch(repoSlug, branch, token));
  const cleanup = options.cleanup ?? ((pr, issue) => invokeCleanup(cleanupScript, pr, issue));
  const log = options.log ?? ((level, message) => appendLog(stateDir, level, message));

  let store = loadStore(stateDir);

  const resolveCandidate = (branch, pr, issue) => {
    const result = cleanup(pr, issue);
    if (result.status === 'cleaned' || result.status === 'already-clean') {
      log('info', `${branch}: ${result.status} (pr #${pr}): ${result.reason ?? ''}`.trim());
      store = clearCandidate(store, branch);
    } else {
      log(
        'error',
        `${branch}: ${result.status} (pr #${pr}): ${result.reason ?? ''} ${result.diagnostic ?? ''}`.trim()
      );
      store = setAttention(store, branch, {
        pr, issue, status: result.status, reason: result.reason, diagnostic: result.diagnostic,
      });
    }
    saveStore(stateDir, store);
  };

  // Pass 1: resume any candidate still pending from an interrupted run,
  // regardless of whether its worktree is still discoverable — dropping it
  // here just because discovery can't see it anymore is exactly the data
  // loss this pass exists to prevent.
  for (const branch of Object.keys(store)) {
    const candidate = store[branch];
    if (candidate.status !== 'pending') continue;
    resolveCandidate(branch, candidate.pr, candidate.issue);
  }

  // Pass 2: discover newly terminal candidates among currently-visible
  // agent worktrees that have no store entry yet.
  const worktrees = discover();
  for (const wt of worktrees) {
    if (getCandidate(store, wt.branch)) continue; // pending (Pass 1 handled it) or has an attention item (no auto-retry)

    let token;
    try {
      token = mint();
    } catch (err) {
      log('warn', `${wt.branch}: token mint failed, will retry next cycle: ${err.message}`);
      continue;
    }

    let pr;
    try {
      pr = findPR(wt.branch, token);
    } catch (err) {
      log('warn', `${wt.branch}: PR lookup failed, will retry next cycle: ${err.message}`);
      continue;
    }

    if (!pr || pr.state === 'OPEN') continue;

    store = setPending(store, wt.branch, { pr: pr.number, issue: wt.issueNumber });
    saveStore(stateDir, store);
    resolveCandidate(wt.branch, pr.number, wt.issueNumber);
  }

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
