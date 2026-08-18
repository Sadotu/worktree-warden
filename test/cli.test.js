import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../src/cli.js';
import { saveStore, loadStore } from '../src/store.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warden-cli-'));
}

test('main("status") prints a report and returns 0', () => {
  const dir = tmpDir();
  const logs = [];
  const originalLog = console.log;
  console.log = (msg) => logs.push(msg);
  try {
    const code = main(['status'], { stateDirOverride: dir });
    assert.equal(code, 0);
    assert.ok(logs.some((l) => l.includes('worktree-warden status')));
  } finally {
    console.log = originalLog;
  }
});

test('main("bogus") returns 1', () => {
  const dir = tmpDir();
  const originalError = console.error;
  console.error = () => {};
  try {
    const code = main(['bogus'], { stateDirOverride: dir });
    assert.equal(code, 1);
  } finally {
    console.error = originalError;
  }
});

function silence(fn) {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

test('main("clear", branch) retries cleanup now; success clears the entry and returns 0', () => {
  const dir = tmpDir();
  saveStore(dir, {
    'agent/1-demo': {
      branch: 'agent/1-demo', pr: '5', issue: '1', status: 'blocked',
      reason: 'primary-worktree-dirty', diagnostic: 'uncommitted changes', updatedAt: 'x',
    },
  });
  let calledWith = null;
  const code = silence(() => main(['clear', 'agent/1-demo'], {
    stateDirOverride: dir,
    primaryWorkspaceOverride: '/fake/workspace',
    cleanupOverride: (pr, issue) => {
      calledWith = [pr, issue];
      return { status: 'cleaned', pr, issue, branch: 'agent/1-demo', merge_mode: 'regular', reason: 'cleanup-complete', diagnostic: '' };
    },
  }));
  assert.equal(code, 0);
  assert.deepEqual(calledWith, ['5', '1']);
  assert.deepEqual(loadStore(dir), {});
});

test('main("clear", branch) still failing: entry stays as an attention item, returns 1', () => {
  const dir = tmpDir();
  saveStore(dir, {
    'agent/1-demo': {
      branch: 'agent/1-demo', pr: '5', issue: '1', status: 'blocked',
      reason: 'primary-worktree-dirty', diagnostic: 'uncommitted changes', updatedAt: 'x',
    },
  });
  const code = silence(() => main(['clear', 'agent/1-demo'], {
    stateDirOverride: dir,
    primaryWorkspaceOverride: '/fake/workspace',
    cleanupOverride: () => ({ status: 'blocked', pr: '5', issue: '1', branch: 'agent/1-demo', merge_mode: null, reason: 'primary-worktree-dirty', diagnostic: 'still dirty' }),
  }));
  assert.equal(code, 1);
  assert.equal(loadStore(dir)['agent/1-demo'].status, 'blocked');
});

test('main("clear", branch) with pr:null deletes the entry without invoking cleanup', () => {
  const dir = tmpDir();
  saveStore(dir, {
    'agent/1-demo': {
      branch: 'agent/1-demo', pr: null, issue: 1, status: 'retry',
      reason: 'token-mint-failed', diagnostic: 'boom', updatedAt: 'x',
    },
  });
  const code = silence(() => main(['clear', 'agent/1-demo'], {
    stateDirOverride: dir,
    primaryWorkspaceOverride: '/fake/workspace',
    cleanupOverride: () => { throw new Error('cleanup should not be called'); },
  }));
  assert.equal(code, 0);
  assert.deepEqual(loadStore(dir), {});
});

test('main("clear", unknown branch) returns 1 and leaves the store unchanged', () => {
  const dir = tmpDir();
  saveStore(dir, {
    'agent/1-demo': {
      branch: 'agent/1-demo', pr: '5', issue: '1', status: 'pending',
      reason: null, diagnostic: null, updatedAt: 'x',
    },
  });
  const code = silence(() => main(['clear', 'agent/missing'], { stateDirOverride: dir }));
  assert.equal(code, 1);
  assert.ok(loadStore(dir)['agent/1-demo']);
});

test('main("clear") with no branch argument returns 1', () => {
  const dir = tmpDir();
  const code = silence(() => main(['clear'], { stateDirOverride: dir }));
  assert.equal(code, 1);
});

test('main("clear", "--all") retries every attention item, leaves pending alone, mixed outcome returns 1', () => {
  const dir = tmpDir();
  saveStore(dir, {
    'agent/1-blocked': {
      branch: 'agent/1-blocked', pr: '5', issue: '1', status: 'blocked',
      reason: 'primary-worktree-dirty', diagnostic: 'x', updatedAt: 'x',
    },
    'agent/2-blocked': {
      branch: 'agent/2-blocked', pr: '6', issue: '2', status: 'blocked',
      reason: 'primary-worktree-dirty', diagnostic: 'x', updatedAt: 'x',
    },
    'agent/3-pending': {
      branch: 'agent/3-pending', pr: '7', issue: '3', status: 'pending',
      reason: null, diagnostic: null, updatedAt: 'x',
    },
  });
  const calls = [];
  const code = silence(() => main(['clear', '--all'], {
    stateDirOverride: dir,
    primaryWorkspaceOverride: '/fake/workspace',
    cleanupOverride: (pr, issue) => {
      calls.push(pr);
      return pr === '5'
        ? { status: 'cleaned', pr, issue, branch: 'x', merge_mode: 'regular', reason: 'cleanup-complete', diagnostic: '' }
        : { status: 'blocked', pr, issue, branch: 'x', merge_mode: null, reason: 'primary-worktree-dirty', diagnostic: 'still dirty' };
    },
  }));
  assert.equal(code, 1);
  assert.deepEqual(calls.sort(), ['5', '6']);
  const store = loadStore(dir);
  assert.equal(store['agent/1-blocked'], undefined);
  assert.equal(store['agent/2-blocked'].status, 'blocked');
  assert.equal(store['agent/3-pending'].status, 'pending');
});

test('main("clear", "--all") with nothing blocked returns 0 without calling cleanup', () => {
  const dir = tmpDir();
  saveStore(dir, {
    'agent/1-pending': {
      branch: 'agent/1-pending', pr: '5', issue: '1', status: 'pending',
      reason: null, diagnostic: null, updatedAt: 'x',
    },
  });
  const code = silence(() => main(['clear', '--all'], {
    stateDirOverride: dir,
    cleanupOverride: () => { throw new Error('cleanup should not be called'); },
  }));
  assert.equal(code, 0);
  assert.ok(loadStore(dir)['agent/1-pending']);
});
