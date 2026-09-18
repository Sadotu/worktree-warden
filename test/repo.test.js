import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  resolveRepoSlug,
  resolvePrimaryWorkspace,
  resolveGitCommonDir,
  resolveStateDir,
  resolveCleanupScriptPath,
} from '../src/repo.js';

function fakeRun(map) {
  return (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    if (!(key in map)) throw new Error(`unexpected command: ${key}`);
    return map[key];
  };
}

test('resolveRepoSlug parses an https origin', () => {
  const run = fakeRun({
    'git remote get-url origin': { status: 0, stdout: 'https://github.com/Sadotu/worktree-warden.git\n', stderr: '' },
  });
  assert.equal(resolveRepoSlug('/repo', run), 'Sadotu/worktree-warden');
});

test('resolveRepoSlug parses an ssh origin', () => {
  const run = fakeRun({
    'git remote get-url origin': { status: 0, stdout: 'git@github.com:Sadotu/worktree-warden.git\n', stderr: '' },
  });
  assert.equal(resolveRepoSlug('/repo', run), 'Sadotu/worktree-warden');
});

test('resolveRepoSlug rejects a non-GitHub origin', () => {
  const run = fakeRun({
    'git remote get-url origin': { status: 0, stdout: 'https://example.com/foo/bar.git\n', stderr: '' },
  });
  assert.throws(() => resolveRepoSlug('/repo', run), /invalid GitHub origin/);
});

test('resolvePrimaryWorkspace reads the first worktree entry', () => {
  const run = fakeRun({
    'git worktree list --porcelain': {
      status: 0,
      stdout: 'worktree /workspaces/worktree-warden\nHEAD abc\nbranch refs/heads/main\n\nworktree /other\nHEAD def\n',
      stderr: '',
    },
  });
  assert.equal(resolvePrimaryWorkspace('/repo', run), '/workspaces/worktree-warden');
});

test('resolveGitCommonDir resolves a relative path against cwd', () => {
  const run = fakeRun({
    'git rev-parse --git-common-dir': { status: 0, stdout: '.git\n', stderr: '' },
  });
  assert.equal(resolveGitCommonDir('/repo', run), path.join('/repo', '.git'));
});

test('resolveStateDir appends worktree-warden to the common dir', () => {
  const run = fakeRun({
    'git rev-parse --git-common-dir': { status: 0, stdout: '/repo/.git\n', stderr: '' },
  });
  assert.equal(resolveStateDir('/repo', run), '/repo/.git/worktree-warden');
});

test('resolveCleanupScriptPath falls back to the installed-layout path when neither layout exists on disk', () => {
  delete process.env.WARDEN_CLEANUP_SCRIPT;
  assert.equal(
    resolveCleanupScriptPath('/workspaces/worktree-warden', () => false),
    '/workspaces/worktree-warden/.agents/skills/github-pr-cleanup/scripts/cleanup.sh'
  );
});

test('resolveCleanupScriptPath honors an env override even when neither layout exists on disk', () => {
  process.env.WARDEN_CLEANUP_SCRIPT = '/tmp/fake-cleanup.sh';
  assert.equal(resolveCleanupScriptPath('/workspaces/worktree-warden', () => false), '/tmp/fake-cleanup.sh');
  delete process.env.WARDEN_CLEANUP_SCRIPT;
});

test('resolveCleanupScriptPath prefers the installed layout when it exists on disk', () => {
  delete process.env.WARDEN_CLEANUP_SCRIPT;
  const installed = '/workspaces/worktree-warden/.agents/skills/github-pr-cleanup/scripts/cleanup.sh';
  const exists = (p) => p === installed;
  assert.equal(resolveCleanupScriptPath('/workspaces/worktree-warden', exists), installed);
});

test('resolveCleanupScriptPath falls back to the source-checkout layout when only it exists on disk', () => {
  delete process.env.WARDEN_CLEANUP_SCRIPT;
  const sourceCheckout = '/workspaces/worktree-warden/skills/github-pr-cleanup/scripts/cleanup.sh';
  const exists = (p) => p === sourceCheckout;
  assert.equal(resolveCleanupScriptPath('/workspaces/worktree-warden', exists), sourceCheckout);
});

test('resolveCleanupScriptPath prefers the installed layout over the source-checkout layout when both exist', () => {
  delete process.env.WARDEN_CLEANUP_SCRIPT;
  const installed = '/workspaces/worktree-warden/.agents/skills/github-pr-cleanup/scripts/cleanup.sh';
  assert.equal(resolveCleanupScriptPath('/workspaces/worktree-warden', () => true), installed);
});

test('resolveCleanupScriptPath does not consult the disk when an env override is set', () => {
  process.env.WARDEN_CLEANUP_SCRIPT = '/tmp/fake-cleanup.sh';
  const exists = () => { throw new Error('exists should not be called when an override is set'); };
  assert.equal(resolveCleanupScriptPath('/workspaces/worktree-warden', exists), '/tmp/fake-cleanup.sh');
  delete process.env.WARDEN_CLEANUP_SCRIPT;
});
