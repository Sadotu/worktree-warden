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

test('resolveCleanupScriptPath defaults under the primary workspace', () => {
  delete process.env.WARDEN_CLEANUP_SCRIPT;
  assert.equal(
    resolveCleanupScriptPath('/workspaces/worktree-warden'),
    '/workspaces/worktree-warden/.agents/skills/github-pr-cleanup/scripts/cleanup.sh'
  );
});

test('resolveCleanupScriptPath honors an env override', () => {
  process.env.WARDEN_CLEANUP_SCRIPT = '/tmp/fake-cleanup.sh';
  assert.equal(resolveCleanupScriptPath('/workspaces/worktree-warden'), '/tmp/fake-cleanup.sh');
  delete process.env.WARDEN_CLEANUP_SCRIPT;
});
