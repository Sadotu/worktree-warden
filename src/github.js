import { run as defaultRun } from './proc.js';

const DEFAULT_HELPER = '/opt/agent-devcontainer/gh-app-token.sh';
const TERMINAL_STATES = new Set(['MERGED', 'CLOSED']);

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

export function findPullRequestsForBranch(repoSlug, branch, token, opts = {}) {
  const run = opts.run ?? defaultRun;
  const result = run(
    'gh',
    ['pr', 'list', '--repo', repoSlug, '--head', branch, '--state', 'all', '--json', 'number,state,closingIssuesReferences', '--limit', '20'],
    { env: { ...process.env, GH_TOKEN: token } }
  );
  if (result.status !== 0) {
    throw new Error(`gh pr list failed for ${branch}: ${result.stderr.trim()}`);
  }
  return JSON.parse(result.stdout || '[]');
}

export function resolveTerminalCandidate(rows) {
  const terminal = rows.filter((row) => TERMINAL_STATES.has(row.state));
  if (terminal.length === 0) {
    return { kind: 'waiting' };
  }
  if (terminal.length > 1) {
    const summary = terminal.map((row) => `#${row.number}(${row.state})`).join(', ');
    return { kind: 'ambiguous', reason: `multiple terminal PRs for this branch: ${summary}` };
  }
  const pr = terminal[0];
  const issues = pr.closingIssuesReferences ?? [];
  if (issues.length === 0) {
    return { kind: 'ambiguous', reason: `PR #${pr.number} has no linked closing issue` };
  }
  if (issues.length > 1) {
    const summary = issues.map((issue) => `#${issue.number}`).join(', ');
    return { kind: 'ambiguous', reason: `PR #${pr.number} closes multiple issues: ${summary}` };
  }
  return { kind: 'ready', number: pr.number, state: pr.state, issue: issues[0].number };
}
