import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderStatus } from '../src/status.js';
import { saveStore } from '../src/store.js';
import { appendLog } from '../src/log.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warden-status-'));
}

test('renderStatus reports no daemon and no tracked branches for an empty state dir', () => {
  const report = renderStatus(tmpDir());
  assert.match(report, /daemon: not running/);
  assert.match(report, /tracked branches: none/);
  assert.match(report, /attention items: 0/);
});

test('renderStatus lists tracked branches and counts attention items', () => {
  const dir = tmpDir();
  saveStore(dir, {
    'agent/1-demo': { outcome: 'waiting', retryCount: 0, attention: false, updatedAt: '2026-08-15T00:00:00.000Z' },
    'agent/2-demo': { outcome: 'blocked', retryCount: 5, attention: true, updatedAt: '2026-08-15T00:00:00.000Z' },
  });
  appendLog(dir, 'error', 'agent/2-demo: blocked (pr #9): Refusing to delete non-agent branch');
  const report = renderStatus(dir);
  assert.match(report, /agent\/1-demo: waiting/);
  assert.match(report, /agent\/2-demo: blocked/);
  assert.match(report, /attention items: 1/);
  assert.match(report, /Refusing to delete non-agent branch/);
});
