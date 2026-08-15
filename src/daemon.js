import { resolvePrimaryWorkspace, resolveRepoSlug, resolveStateDir, resolveCleanupScriptPath } from './repo.js';
import { discoverAgentWorktrees } from './discovery.js';
import { mintToken, findPullRequestsForBranch, resolveTerminalCandidate } from './github.js';
import { invokeCleanup } from './cleanup.js';
import { loadStore, saveStore, getCandidate, setPending, setAttention, clearCandidate } from './store.js';
import { appendLog } from './log.js';

export const DAEMON_ERROR_KEY = '__runOnce__';

export function runOnce(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const primaryWorkspace = options.primaryWorkspace ?? resolvePrimaryWorkspace(cwd);
  const repoSlug = options.repoSlug ?? resolveRepoSlug(cwd);
  const stateDir = options.stateDir ?? resolveStateDir(cwd);
  const cleanupScript = options.cleanupScript ?? resolveCleanupScriptPath(primaryWorkspace);
  const discover = options.discover ?? (() => discoverAgentWorktrees(primaryWorkspace));
  const mint = options.mint ?? (() => mintToken(repoSlug));
  const findPRs = options.findPRs ?? ((branch, token) => findPullRequestsForBranch(repoSlug, branch, token));
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
  // regardless of whether its worktree is still discoverable.
  for (const branch of Object.keys(store)) {
    const candidate = store[branch];
    if (candidate.status !== 'pending') continue;
    resolveCandidate(branch, candidate.pr, candidate.issue);
  }

  // Pass 2: discover newly terminal candidates among currently-visible
  // agent worktrees that have no store entry yet. Every failure here — a
  // failed mint, a failed PR lookup, or an ambiguous PR/issue relationship
  // — writes a permanent attention item immediately. None of them is
  // retried automatically; the branch is simply skipped on every future
  // cycle until a human clears it.
  const worktrees = discover();
  for (const wt of worktrees) {
    if (getCandidate(store, wt.branch)) continue; // pending (Pass 1 handled it) or has an attention item (no auto-retry)

    let token;
    try {
      token = mint();
    } catch (err) {
      log('error', `${wt.branch}: token mint failed: ${err.message}`);
      store = setAttention(store, wt.branch, {
        pr: null, issue: wt.issueNumber, status: 'retry', reason: 'token-mint-failed', diagnostic: err.message,
      });
      saveStore(stateDir, store);
      continue;
    }

    let rows;
    try {
      rows = findPRs(wt.branch, token);
    } catch (err) {
      log('error', `${wt.branch}: PR lookup failed: ${err.message}`);
      store = setAttention(store, wt.branch, {
        pr: null, issue: wt.issueNumber, status: 'retry', reason: 'pr-lookup-failed', diagnostic: err.message,
      });
      saveStore(stateDir, store);
      continue;
    }

    const resolved = resolveTerminalCandidate(rows);
    if (resolved.kind === 'waiting') continue;

    if (resolved.kind === 'ambiguous') {
      log('error', `${wt.branch}: blocked (pr/issue relationship unresolved): ${resolved.reason}`);
      store = setAttention(store, wt.branch, {
        pr: null, issue: wt.issueNumber, status: 'blocked', reason: 'pr-issue-ambiguous', diagnostic: resolved.reason,
      });
      saveStore(stateDir, store);
      continue;
    }

    store = setPending(store, wt.branch, { pr: resolved.number, issue: resolved.issue });
    saveStore(stateDir, store);
    resolveCandidate(wt.branch, resolved.number, resolved.issue);
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
      try {
        let store = loadStore(stateDir);
        store = setAttention(store, DAEMON_ERROR_KEY, {
          pr: null, issue: null, status: 'retry', reason: 'runOnce-failed', diagnostic: err.message,
        });
        saveStore(stateDir, store);
      } catch {
        // best-effort; the log line above is the fallback record if this also fails.
      }
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };

  tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
