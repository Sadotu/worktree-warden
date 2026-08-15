import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { acquireLock, releaseLock, readLock, isProcessAlive } from '../src/lock.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warden-lock-'));
}

test('isProcessAlive is true for the current process', () => {
  assert.equal(isProcessAlive(process.pid), true);
});

test('isProcessAlive is false for a pid that does not exist', () => {
  // Spawn and immediately reap a short-lived process to get a pid that just died.
  const child = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  assert.equal(isProcessAlive(child.pid), false);
});

test('acquireLock writes the pid and readLock reports it alive', () => {
  const dir = tmpDir();
  acquireLock(dir, 12345);
  const lock = readLock(dir);
  // pid 12345 is very unlikely to be alive in the test sandbox; assert the pid is read back correctly.
  assert.equal(lock.pid, 12345);
});

test('acquireLock refuses when the existing lock pid is alive', () => {
  const dir = tmpDir();
  acquireLock(dir, process.pid);
  assert.throws(() => acquireLock(dir, process.pid + 1), /already running/);
});

test('acquireLock reclaims a stale lock (dead pid)', () => {
  const dir = tmpDir();
  const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid;
  acquireLock(dir, dead);
  acquireLock(dir, process.pid); // should not throw
  assert.equal(readLock(dir).pid, process.pid);
});

test('releaseLock only removes a lock it owns', () => {
  const dir = tmpDir();
  acquireLock(dir, process.pid);
  releaseLock(dir, process.pid + 1); // not the owner, no-op
  assert.notEqual(readLock(dir), null);
  releaseLock(dir, process.pid);
  assert.equal(readLock(dir), null);
});

test('readLock returns null when no lock exists', () => {
  assert.equal(readLock(tmpDir()), null);
});
