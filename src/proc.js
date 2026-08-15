import { spawnSync } from 'node:child_process';

export function run(cmd, args = [], options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  };
}
