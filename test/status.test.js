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

test('renderStatus reports no daemon and no tracked candidates for an empty state dir', () => {
  const report = renderStatus(tmpDir());
  assert.match(report, /daemon: not running/);
  assert.match(report, /tracked candidates: none/);
  assert.match(report, /attention items: 0/);
});

test('renderStatus lists a pending candidate and a blocked attention item, counting only the latter', () => {
  const dir = tmpDir();
  saveStore(dir, {
    'agent/1-demo': { branch: 'agent/1-demo', pr: '5', issue: '1', status: 'pending', reason: null, diagnostic: null, updatedAt: '2026-08-15T00:00:00.000Z' },
    'agent/2-demo': { branch: 'agent/2-demo', pr: '9', issue: '2', status: 'blocked', reason: 'worktree-dirty', diagnostic: 'uncommitted changes', updatedAt: '2026-08-15T00:00:00.000Z' },
  });
  appendLog(dir, 'error', 'agent/2-demo: blocked (pr #9): worktree-dirty uncommitted changes');
  const report = renderStatus(dir);
  assert.match(report, /agent\/1-demo: pending/);
  assert.match(report, /agent\/2-demo: blocked/);
  assert.match(report, /attention items: 1/);
  assert.match(report, /worktree-dirty/);
});
