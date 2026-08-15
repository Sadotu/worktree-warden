import { run as defaultRun } from './proc.js';

const DEFAULT_HELPER = '/opt/agent-devcontainer/gh-app-token.sh';

export function mintToken(repoSlug, opts = {}) {
  const run = opts.run ?? defaultRun;
  const helperPath = opts.helperPath ?? process.env.GH_APP_TOKEN_HELPER ?? DEFAULT_HELPER;
  const result = run(helperPath, [], { env: { ...process.env, GITHUB_APP_REPO: repoSlug } });
  const token = result.stdout.trim();
  if (result.status !== 0 || !token) {
    throw new Error(`failed to mint GitHub App token: ${result.stderr.trim() || 'empty token'}`);
  }
  return token;
}

export function findPullRequestForBranch(repoSlug, branch, token, opts = {}) {
  const run = opts.run ?? defaultRun;
  const result = run(
    'gh',
    ['pr', 'list', '--repo', repoSlug, '--head', branch, '--state', 'all', '--json', 'number,state', '--limit', '20'],
    { env: { ...process.env, GH_TOKEN: token } }
  );
  if (result.status !== 0) {
    throw new Error(`gh pr list failed for ${branch}: ${result.stderr.trim()}`);
  }
  const rows = JSON.parse(result.stdout || '[]');
  if (rows.length === 0) return null;
  const open = rows.find((row) => row.state === 'OPEN');
  if (open) return { number: open.number, state: open.state };
  const merged = rows.find((row) => row.state === 'MERGED');
  if (merged) return { number: merged.number, state: merged.state };
  const newestClosed = rows.reduce((a, b) => (b.number > a.number ? b : a));
  return { number: newestClosed.number, state: newestClosed.state };
}
