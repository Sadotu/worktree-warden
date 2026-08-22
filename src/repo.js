import path from 'node:path';
import { run as defaultRun } from './proc.js';

export function resolveRepoSlug(cwd = process.cwd(), run = defaultRun) {
  const result = run('git', ['remote', 'get-url', 'origin'], { cwd });
  if (result.status !== 0) {
    throw new Error(`unable to read git remote origin: ${result.stderr.trim()}`);
  }
  const origin = result.stdout.trim();
  const match =
    origin.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+?)(\.git)?$/) ||
    origin.match(/^git@github\.com:([^/]+)\/([^/.]+?)(\.git)?$/) ||
    origin.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^/.]+?)(\.git)?$/);
  if (!match) {
    throw new Error(`invalid GitHub origin: expected owner/repo on github.com, got "${origin}"`);
  }
  const [, owner, repo] = match;
  return `${owner}/${repo}`;
}

export function resolvePrimaryWorkspace(cwd = process.cwd(), run = defaultRun) {
  const result = run('git', ['worktree', 'list', '--porcelain'], { cwd });
  if (result.status !== 0) {
    throw new Error(`unable to list git worktrees: ${result.stderr.trim()}`);
  }
  const match = result.stdout.match(/^worktree (.+)$/m);
  if (!match) {
    throw new Error('unable to resolve primary worktree from `git worktree list --porcelain`');
  }
  return match[1];
}

export function resolveGitCommonDir(cwd = process.cwd(), run = defaultRun) {
  const result = run('git', ['rev-parse', '--git-common-dir'], { cwd });
  if (result.status !== 0) {
    throw new Error(`unable to resolve git common dir: ${result.stderr.trim()}`);
  }
  const dir = result.stdout.trim();
  return path.isAbsolute(dir) ? dir : path.join(cwd, dir);
}

export function resolveStateDir(cwd = process.cwd(), run = defaultRun) {
  return path.join(resolveGitCommonDir(cwd, run), 'worktree-warden');
}

export function resolveCleanupScriptPath(primaryWorkspace) {
  if (process.env.WARDEN_CLEANUP_SCRIPT) return process.env.WARDEN_CLEANUP_SCRIPT;
  return path.join(primaryWorkspace, '.agents/skills/github-pr-cleanup/scripts/cleanup.sh');
}
