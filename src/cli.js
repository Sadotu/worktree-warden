import { resolveStateDir, resolvePrimaryWorkspace, resolveCleanupScriptPath } from './repo.js';
import { acquireLock, releaseLock } from './lock.js';
import { loop, applyCleanup } from './daemon.js';
import { invokeCleanup } from './cleanup.js';
import { renderStatus } from './status.js';
import { appendLog } from './log.js';
import { loadStore, saveStore, getCandidate, clearCandidate } from './store.js';

export function main(argv, {
  cwd = process.cwd(), stateDirOverride, primaryWorkspaceOverride, cleanupScriptOverride, cleanupOverride,
} = {}) {
  const command = argv[0];
  const stateDir = stateDirOverride ?? resolveStateDir(cwd);

  if (command === 'status') {
    console.log(renderStatus(stateDir));
    return 0;
  }

  if (command === 'clear') {
    const args = argv.slice(1);
    const all = args.includes('--all');
    const branch = args.find((a) => a !== '--all');
    if (!all && !branch) {
      console.error('usage: worktree-warden clear <branch> | worktree-warden clear --all');
      return 1;
    }

    let store = loadStore(stateDir);
    if (!all && !getCandidate(store, branch)) {
      console.error(`no tracked candidate for ${branch}`);
      return 1;
    }

    const targets = all
      ? Object.keys(store).filter((b) => store[b].status !== 'pending')
      : [branch];

    if (all && targets.length === 0) {
      console.log('nothing to clear');
      return 0;
    }

    const primaryWorkspace = primaryWorkspaceOverride ?? resolvePrimaryWorkspace(cwd);
    const cleanupScript = cleanupScriptOverride ?? resolveCleanupScriptPath(primaryWorkspace);
    const cleanup = cleanupOverride ?? ((pr, issue) => invokeCleanup(cleanupScript, pr, issue));
    const log = (level, message) => appendLog(stateDir, level, message);

    let failures = 0;
    for (const b of targets) {
      const candidate = getCandidate(store, b);
      if (!candidate.pr) {
        store = clearCandidate(store, b);
        saveStore(stateDir, store);
        log('info', `${b}: cleared by operator (no pr — rediscovered fresh next poll)`);
        console.log(`${b}: cleared (rediscover on next poll)`);
        continue;
      }
      const outcome = applyCleanup(store, b, candidate.pr, candidate.issue, { cleanup, log });
      store = outcome.store;
      saveStore(stateDir, store);
      if (outcome.result.status === 'cleaned' || outcome.result.status === 'already-clean') {
        console.log(`${b}: ${outcome.result.status}`);
      } else {
        failures += 1;
        console.error(`${b}: still ${outcome.result.status} (${outcome.result.reason ?? 'unknown'})`);
      }
    }
    return failures > 0 ? 1 : 0;
  }

  if (command) {
    console.error(`unknown command: ${command}`);
    return 1;
  }

  const primaryWorkspace = resolvePrimaryWorkspace(cwd);
  process.chdir(primaryWorkspace);

  acquireLock(stateDir);
  appendLog(stateDir, 'info', 'worktree-warden started');
  const stop = loop({ cwd: primaryWorkspace, stateDir });

  const shutdown = (signal) => {
    appendLog(stateDir, 'info', `worktree-warden stopping (${signal})`);
    stop();
    releaseLock(stateDir);
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return null;
}
