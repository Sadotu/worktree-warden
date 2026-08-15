import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runOnce } from '../src/daemon.js';
import { loadStore } from '../src/store.js';

test('end-to-end: real worktree discovery feeds runOnce, which cleans a merged branch', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'warden-e2e-'));
  const git = (...args) => execFileSync('git', args, { cwd: tmp, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(tmp, 'README.md'), 'hello\n');
  git('add', 'README.md');
  git('commit', '-q', '-m', 'init');
  git('branch', 'agent/7-e2e-demo');
  const agentWt = path.join(tmp, 'agent-wt');
  git('worktree', 'add', agentWt, 'agent/7-e2e-demo');

  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warden-e2e-state-'));
  let cleanupCalls = 0;
  const store = runOnce({
    primaryWorkspace: tmp,
    repoSlug: 'Sadotu/worktree-warden',
    stateDir,
    cleanupScript: '/unused',
    mint: () => 'tok',
    findPR: (branch) => {
      assert.equal(branch, 'agent/7-e2e-demo');
      return { number: 99, state: 'MERGED' };
    },
    cleanup: (pr, issue) => {
      cleanupCalls += 1;
      assert.equal(pr, 99);
      assert.equal(issue, 7);
      return { status: 'cleaned', pr: '99', issue: '7', branch: 'agent/7-e2e-demo', merge_mode: 'regular', reason: 'cleanup-complete', diagnostic: '' };
    },
    log: () => {},
  });

  assert.equal(cleanupCalls, 1);
  assert.equal(store['agent/7-e2e-demo'], undefined);
  assert.deepEqual(loadStore(stateDir), {});

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(stateDir, { recursive: true, force: true });
});
