import { resolveStateDir } from './repo.js';
import { acquireLock, releaseLock } from './lock.js';
import { loop } from './daemon.js';
import { renderStatus } from './status.js';
import { appendLog } from './log.js';

export function main(argv, { cwd = process.cwd(), stateDirOverride } = {}) {
  const command = argv[0];
  const stateDir = stateDirOverride ?? resolveStateDir(cwd);

  if (command === 'status') {
    console.log(renderStatus(stateDir));
    return 0;
  }

  if (command) {
    console.error(`unknown command: ${command}`);
    return 1;
  }

  acquireLock(stateDir);
  appendLog(stateDir, 'info', 'worktree-warden started');
  const stop = loop({ cwd, stateDir });

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
