import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseWorktreePorcelain, discoverAgentWorktrees } from '../src/discovery.js';

const SAMPLE = `worktree /workspaces/worktree-warden
HEAD 5e39a775
branch refs/heads/main

worktree /workspaces/worktree-warden/.claude/worktrees/agent-1-merged-pr-watch-daemon
HEAD 065feb8
branch refs/heads/agent/1-merged-pr-watch-daemon

worktree /workspaces/worktree-warden/.claude/worktrees/scratch
HEAD 1234abcd
branch refs/heads/not-an-agent-branch

worktree /workspaces/worktree-warden/.claude/worktrees/detached
HEAD 9999999
detached

`;

test('parseWorktreePorcelain finds only agent/<issue>-<slug> branches', () => {
  const entries = parseWorktreePorcelain(SAMPLE);
  assert.deepEqual(entries, [
    {
      path: '/workspaces/worktree-warden/.claude/worktrees/agent-1-merged-pr-watch-daemon',
      branch: 'agent/1-merged-pr-watch-daemon',
      issueNumber: 1,
      slug: 'merged-pr-watch-daemon',
    },
  ]);
});

test('parseWorktreePorcelain ignores main, unrelated branches, and detached worktrees', () => {
  const entries = parseWorktreePorcelain(SAMPLE);
  assert.equal(entries.some((e) => e.branch === 'main'), false);
  assert.equal(entries.some((e) => e.branch === 'not-an-agent-branch'), false);
});

test('discoverAgentWorktrees delegates to git worktree list --porcelain', () => {
  const run = (cmd, args, options) => {
    assert.equal(cmd, 'git');
    assert.deepEqual(args, ['worktree', 'list', '--porcelain']);
    assert.equal(options.cwd, '/workspaces/worktree-warden');
    return { status: 0, stdout: SAMPLE, stderr: '' };
  };
  const entries = discoverAgentWorktrees('/workspaces/worktree-warden', run);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].issueNumber, 1);
});

test('discoverAgentWorktrees throws when git fails', () => {
  const run = () => ({ status: 1, stdout: '', stderr: 'not a git repository' });
  assert.throws(() => discoverAgentWorktrees('/nope', run), /unable to list git worktrees/);
});

test('integration: discoverAgentWorktrees against a real temporary git repo', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'warden-discovery-'));
  const git = (...args) => execFileSync('git', args, { cwd: tmp, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(tmp, 'README.md'), 'hello\n');
  git('add', 'README.md');
  git('commit', '-q', '-m', 'init');
  git('branch', 'agent/42-demo-feature');
  git('branch', 'humans-doing-manual-work');
  const agentWt = path.join(tmp, 'agent-wt');
  const manualWt = path.join(tmp, 'manual-wt');
  git('worktree', 'add', agentWt, 'agent/42-demo-feature');
  git('worktree', 'add', manualWt, 'humans-doing-manual-work');

  const entries = discoverAgentWorktrees(tmp);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].branch, 'agent/42-demo-feature');
  assert.equal(entries[0].issueNumber, 42);
  assert.equal(entries[0].slug, 'demo-feature');
  assert.equal(fs.realpathSync(entries[0].path), fs.realpathSync(agentWt));

  fs.rmSync(tmp, { recursive: true, force: true });
});
