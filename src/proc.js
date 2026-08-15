import { spawnSync } from 'node:child_process';

export function run(cmd, args = [], options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  const stderr = result.stderr ?? '';
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.error ? `${stderr}${stderr ? '\n' : ''}${result.error.message}` : stderr,
    error: result.error,
  };
}
