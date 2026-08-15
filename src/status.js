import { loadStore } from './store.js';
import { readLock } from './lock.js';
import { readLogTail } from './log.js';

export function renderStatus(stateDir) {
  const store = loadStore(stateDir);
  const lock = readLock(stateDir);
  const branches = Object.entries(store);
  const lines = [];

  lines.push('worktree-warden status');
  lines.push(lock && lock.alive ? `daemon: running (pid ${lock.pid})` : 'daemon: not running');

  if (branches.length === 0) {
    lines.push('tracked branches: none');
  } else {
    lines.push('tracked branches:');
    for (const [branch, state] of branches) {
      const marker = state.attention ? '!' : ' ';
      lines.push(`  ${marker} ${branch}: ${state.outcome} (retries=${state.retryCount}, updated=${state.updatedAt})`);
    }
  }

  const attentionCount = branches.filter(([, state]) => state.attention).length;
  lines.push(`attention items: ${attentionCount}`);

  const tail = readLogTail(stateDir, 10);
  if (tail.length > 0) {
    lines.push('recent log:');
    for (const line of tail) lines.push(`  ${line}`);
  }

  return lines.join('\n');
}
