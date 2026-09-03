import { resolvePrimaryWorkspace, resolveRepoSlug, resolveStateDir, resolveCleanupScriptPath } from './repo.js';
import { discoverAgentWorktrees } from './discovery.js';
import { mintToken, findPullRequestsForBranch, resolveTerminalCandidate } from './github.js';
import { invokeCleanup } from './cleanup.js';
import { loadStore, saveStore, getCandidate, setPending, setAttention, clearCandidate } from './store.js';
import { appendLog } from './log.js';

export const DAEMON_ERROR_KEY = '__runOnce__';

// Bounded exponential backoff for operational PR-lookup failures (token
// mint, `gh pr list`): 1m, 2m, 4m, ... capped at 30m so a still-down
// GitHub App or network doesn't produce a tight retry loop or noisy logs.
const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 30 * 60_000;

export function computeNextRetry(previousAttempt, nowMs) {
  const attempt = (previousAttempt ?? 0) + 1;
  const delayMs = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempt - 1));
  return { attempt, nextRetryAt: new Date(nowMs + delayMs).toISOString() };
}

function isRetryDue(candidate, nowMs) {
  return !candidate.nextRetryAt || new Date(candidate.nextRetryAt).getTime() <= nowMs;
}

// Invokes cleanup for a candidate already known to have a `pr`, and folds
// the result back into the store — `cleaned`/`already-clean` clears the
// entry, anything else records it as an attention item. Shared by the
// daemon's own passes and the CLI's `clear` command, so a manual retry
// updates the store identically to an automatic one.
export function applyCleanup(store, branch, pr, issue, { cleanup, log }) {
  const result = cleanup(pr, issue);
  if (result.status === 'cleaned' || result.status === 'already-clean') {
    log('info', `${branch}: ${result.status} (pr #${pr}): ${result.reason ?? ''}`.trim());
    return { store: clearCandidate(store, branch), result };
  }
  log(
    'error',
    `${branch}: ${result.status} (pr #${pr}): ${result.reason ?? ''} ${result.diagnostic ?? ''}`.trim()
  );
  return {
    store: setAttention(store, branch, {
      pr, issue, status: result.status, reason: result.reason, diagnostic: result.diagnostic,
    }),
    result,
  };
}

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
  const now = options.now ?? (() => Date.now());

  let store = loadStore(stateDir);

  const resolveCandidate = (branch, pr, issue) => {
    const outcome = applyCleanup(store, branch, pr, issue, { cleanup, log });
    store = outcome.store;
    saveStore(stateDir, store);
  };

  // Pass 1: resume any candidate still pending from an interrupted run,
  // regardless of whether its worktree is still discoverable.
  for (const branch of Object.keys(store)) {
    const candidate = store[branch];
    if (candidate.status !== 'pending') continue;
    if (!candidate.pr) {
      log('error', `${branch}: pending candidate has no pr identity — delete this entry instead of setting it to pending; see README`);
      store = setAttention(store, branch, {
        pr: null, issue: candidate.issue ?? null, status: 'blocked', reason: 'missing-pr-identity', diagnostic: 'a pending candidate must have a pr set by a real Phase 7 invocation; this entry cannot be resumed',
      });
      saveStore(stateDir, store);
      continue;
    }
    resolveCandidate(branch, candidate.pr, candidate.issue);
  }

  // Pass 2: discover newly terminal candidates among currently-visible
  // agent worktrees. A branch with no store entry yet is looked up fresh.
  // A branch already tracked as an operational retry (`status: 'retry'`,
  // `pr: null` — token mint or PR-lookup itself failed, so no pr/issue was
  // ever resolved) is looked up again once its backoff window has elapsed.
  // Anything else already tracked — `pending`, `blocked`, or a cleanup-level
  // `retry` with a `pr` on record (Pass 1's territory) — is left alone.
  // An ambiguous PR/issue relationship still writes a permanent attention
  // item; a human must resolve it.
  const nowMs = now();
  const worktrees = discover();
  for (const wt of worktrees) {
    const existing = getCandidate(store, wt.branch);
    if (existing && !(existing.status === 'retry' && !existing.pr && isRetryDue(existing, nowMs))) continue;

    let token;
    try {
      token = mint();
    } catch (err) {
      log('error', `${wt.branch}: token mint failed: ${err.message}`);
      const { attempt, nextRetryAt } = computeNextRetry(existing?.attempt, nowMs);
      store = setAttention(store, wt.branch, {
        pr: null, issue: wt.issueNumber, status: 'retry', reason: 'token-mint-failed', diagnostic: err.message, attempt, nextRetryAt,
      });
      saveStore(stateDir, store);
      continue;
    }

    let resolved;
    try {
      const rows = findPRs(wt.branch, token);
      resolved = resolveTerminalCandidate(rows);
    } catch (err) {
      log('error', `${wt.branch}: PR lookup failed: ${err.message}`);
      const { attempt, nextRetryAt } = computeNextRetry(existing?.attempt, nowMs);
      store = setAttention(store, wt.branch, {
        pr: null, issue: wt.issueNumber, status: 'retry', reason: 'pr-lookup-failed', diagnostic: err.message, attempt, nextRetryAt,
      });
      saveStore(stateDir, store);
      continue;
    }

    if (resolved.kind === 'waiting') {
      if (existing) {
        log('info', `${wt.branch}: recovered (still waiting on a terminal PR state); cleared retry state`);
        store = clearCandidate(store, wt.branch);
        saveStore(stateDir, store);
      }
      continue;
    }

    if (resolved.kind === 'ambiguous') {
      log('error', `${wt.branch}: blocked (pr/issue relationship unresolved): ${resolved.reason}`);
      store = setAttention(store, wt.branch, {
        pr: null, issue: null, status: 'blocked', reason: 'pr-issue-ambiguous', diagnostic: resolved.reason,
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
