import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../src/cli.js';

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
