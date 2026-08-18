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

test('main("clear", branch) removes a tracked candidate and returns 0', () => {
  const dir = tmpDir();
  saveStore(dir, {
    'agent/1-demo': {
      branch: 'agent/1-demo', pr: '5', issue: '1', status: 'blocked',
      reason: 'primary-worktree-dirty', diagnostic: 'uncommitted changes', updatedAt: 'x',
    },
  });
  const logs = [];
  const originalLog = console.log;
  console.log = (msg) => logs.push(msg);
  try {
    const code = main(['clear', 'agent/1-demo'], { stateDirOverride: dir });
    assert.equal(code, 0);
    assert.ok(logs.some((l) => l.includes('agent/1-demo')));
  } finally {
    console.log = originalLog;
  }
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
  const logs = [];
  const originalError = console.error;
  console.error = (msg) => logs.push(msg);
  try {
    const code = main(['clear', 'agent/missing'], { stateDirOverride: dir });
    assert.equal(code, 1);
    assert.ok(logs.some((l) => l.includes('agent/missing')));
  } finally {
    console.error = originalError;
  }
  assert.ok(loadStore(dir)['agent/1-demo']);
});

test('main("clear") with no branch argument returns 1', () => {
  const dir = tmpDir();
  const originalError = console.error;
  console.error = () => {};
  try {
    const code = main(['clear'], { stateDirOverride: dir });
    assert.equal(code, 1);
  } finally {
    console.error = originalError;
  }
});
