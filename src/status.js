import { loadStore } from './store.js';
import { readLock } from './lock.js';
import { readLogTail } from './log.js';

export function renderStatus(stateDir) {
  const store = loadStore(stateDir);
  const lock = readLock(stateDir);
  const entries = Object.entries(store);
  const lines = [];

  lines.push('worktree-warden status');
  lines.push(lock && lock.alive ? `daemon: running (pid ${lock.pid})` : 'daemon: not running');

  if (entries.length === 0) {
    lines.push('tracked candidates: none');
  } else {
    lines.push('tracked candidates:');
    for (const [branch, candidate] of entries) {
      if (candidate.status === 'pending') {
        lines.push(`    ${branch}: pending (pr #${candidate.pr}, issue #${candidate.issue}, updated=${candidate.updatedAt})`);
      } else {
        lines.push(
          `  ! ${branch}: ${candidate.status} (pr #${candidate.pr}, issue #${candidate.issue}, reason=${candidate.reason ?? 'unknown'}, updated=${candidate.updatedAt})`
        );
      }
    }
  }

  const attentionCount = entries.filter(([, candidate]) => candidate.status !== 'pending').length;
  lines.push(`attention items: ${attentionCount}`);

  const tail = readLogTail(stateDir, 10);
  if (tail.length > 0) {
    lines.push('recent log:');
    for (const line of tail) lines.push(`  ${line}`);
  }

  return lines.join('\n');
}
