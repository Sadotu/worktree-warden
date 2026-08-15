import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendLog, readLogTail } from '../src/log.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warden-log-'));
}

test('readLogTail returns [] when no log file exists', () => {
  assert.deepEqual(readLogTail(tmpDir()), []);
});

test('appendLog writes a timestamped, leveled line readable via readLogTail', () => {
  const dir = tmpDir();
  appendLog(dir, 'info', 'hello world');
  const [line] = readLogTail(dir);
  assert.match(line, /^\d{4}-\d{2}-\d{2}T.*\[info] hello world$/);
});

test('readLogTail returns only the last maxLines entries, most recent last', () => {
  const dir = tmpDir();
  for (let i = 0; i < 5; i++) appendLog(dir, 'info', `line ${i}`);
  const tail = readLogTail(dir, 2);
  assert.equal(tail.length, 2);
  assert.match(tail[0], /line 3$/);
  assert.match(tail[1], /line 4$/);
});

test('appendLog bounds the file size, dropping the oldest lines', () => {
  const dir = tmpDir();
  const bigMessage = 'x'.repeat(1024);
  for (let i = 0; i < 2000; i++) appendLog(dir, 'info', `${i} ${bigMessage}`);
  const file = path.join(dir, 'warden.log');
  const size = fs.statSync(file).size;
  assert.ok(size < 1024 * 1024 * 1.1, `log file grew unbounded: ${size} bytes`);
  const tail = readLogTail(dir, 5);
  assert.match(tail.at(-1), /1999/);
});
