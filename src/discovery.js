import { run as defaultRun } from './proc.js';

const AGENT_BRANCH_RE = /^agent\/(\d+)-([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/;

export function parseWorktreePorcelain(porcelainText) {
  const entries = [];
  let current = null;
  for (const line of porcelainText.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length) };
      entries.push(current);
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (line === '') {
      current = null;
    }
  }
  return entries
    .filter((e) => e.branch)
    .map((e) => {
      const match = e.branch.match(AGENT_BRANCH_RE);
      if (!match) return null;
      return { path: e.path, branch: e.branch, issueNumber: Number(match[1]), slug: match[2] };
    })
    .filter(Boolean);
}

export function discoverAgentWorktrees(primaryWorkspace, run = defaultRun) {
  const result = run('git', ['worktree', 'list', '--porcelain'], { cwd: primaryWorkspace });
  if (result.status !== 0) {
    throw new Error(`unable to list git worktrees: ${result.stderr.trim()}`);
  }
  return parseWorktreePorcelain(result.stdout);
}
