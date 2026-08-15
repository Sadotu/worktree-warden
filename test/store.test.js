import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadStore, saveStore, getBranchState, setBranchState, clearBranchState,
} from '../src/store.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warden-store-'));
}

test('loadStore returns {} when no file exists', () => {
  assert.deepEqual(loadStore(tmpDir()), {});
});

test('loadStore returns {} on corrupt JSON', () => {
  const dir = tmpDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), 'not json');
  assert.deepEqual(loadStore(dir), {});
});

test('saveStore then loadStore round-trips, creating the dir', () => {
  const dir = path.join(tmpDir(), 'nested');
  saveStore(dir, { 'agent/1-demo': { outcome: 'waiting', retryCount: 0, attention: false, updatedAt: 'x' } });
  assert.deepEqual(loadStore(dir), {
    'agent/1-demo': { outcome: 'waiting', retryCount: 0, attention: false, updatedAt: 'x' },
  });
});

test('getBranchState returns a default for an unknown branch', () => {
  assert.deepEqual(getBranchState({}, 'agent/1-demo'), {
    outcome: null, retryCount: 0, attention: false, updatedAt: null,
  });
});

test('setBranchState merges and does not mutate the input', () => {
  const before = {};
  const after = setBranchState(before, 'agent/1-demo', { outcome: 'retry', retryCount: 1 });
  assert.deepEqual(before, {});
  assert.equal(after['agent/1-demo'].outcome, 'retry');
  assert.equal(after['agent/1-demo'].retryCount, 1);
  assert.equal(typeof after['agent/1-demo'].updatedAt, 'string');
});

test('clearBranchState removes the branch without mutating the input', () => {
  const before = { 'agent/1-demo': { outcome: 'cleaned', retryCount: 0, attention: false, updatedAt: 'x' } };
  const after = clearBranchState(before, 'agent/1-demo');
  assert.deepEqual(before, { 'agent/1-demo': { outcome: 'cleaned', retryCount: 0, attention: false, updatedAt: 'x' } });
  assert.deepEqual(after, {});
});
