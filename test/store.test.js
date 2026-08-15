import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadStore, saveStore, getCandidate, setPending, setAttention, clearCandidate,
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
  saveStore(dir, {
    'agent/1-demo': { branch: 'agent/1-demo', pr: '5', issue: '1', status: 'pending', reason: null, diagnostic: null, updatedAt: 'x' },
  });
  assert.deepEqual(loadStore(dir), {
    'agent/1-demo': { branch: 'agent/1-demo', pr: '5', issue: '1', status: 'pending', reason: null, diagnostic: null, updatedAt: 'x' },
  });
});

test('getCandidate returns null for an unknown branch', () => {
  assert.equal(getCandidate({}, 'agent/1-demo'), null);
});

test('setPending creates a pending candidate without mutating the input', () => {
  const before = {};
  const after = setPending(before, 'agent/1-demo', { pr: '5', issue: '1' });
  assert.deepEqual(before, {});
  const candidate = getCandidate(after, 'agent/1-demo');
  assert.equal(candidate.branch, 'agent/1-demo');
  assert.equal(candidate.pr, '5');
  assert.equal(candidate.issue, '1');
  assert.equal(candidate.status, 'pending');
  assert.equal(candidate.reason, null);
  assert.equal(candidate.diagnostic, null);
  assert.equal(typeof candidate.updatedAt, 'string');
});

test('setAttention records a terminal status without mutating the input', () => {
  const before = setPending({}, 'agent/1-demo', { pr: '5', issue: '1' });
  const after = setAttention(before, 'agent/1-demo', {
    pr: '5', issue: '1', status: 'blocked', reason: 'worktree-dirty', diagnostic: 'uncommitted changes',
  });
  assert.equal(getCandidate(before, 'agent/1-demo').status, 'pending');
  const candidate = getCandidate(after, 'agent/1-demo');
  assert.equal(candidate.status, 'blocked');
  assert.equal(candidate.reason, 'worktree-dirty');
  assert.equal(candidate.diagnostic, 'uncommitted changes');
});

test('clearCandidate removes the branch without mutating the input', () => {
  const before = setPending({}, 'agent/1-demo', { pr: '5', issue: '1' });
  const after = clearCandidate(before, 'agent/1-demo');
  assert.notEqual(getCandidate(before, 'agent/1-demo'), null);
  assert.equal(getCandidate(after, 'agent/1-demo'), null);
});
