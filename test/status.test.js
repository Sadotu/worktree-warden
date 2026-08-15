import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderStatus } from '../src/status.js';
import { saveStore } from '../src/store.js';
import { appendLog } from '../src/log.js';
import { DAEMON_ERROR_KEY } from '../src/daemon.js';

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
  assert.match(report, /diagnostic=uncommitted changes/);
});

test('renderStatus renders pr #— and issue #— for a branch attention item with no pr/issue identity', () => {
  const dir = tmpDir();
  saveStore(dir, {
    'agent/1-demo': { branch: 'agent/1-demo', pr: null, issue: null, status: 'retry', reason: 'token-mint-failed', diagnostic: 'could not resolve installation id', updatedAt: '2026-08-15T00:00:00.000Z' },
  });
  const report = renderStatus(dir);
  assert.match(report, /pr #—/);
  assert.match(report, /issue #—/);
  assert.doesNotMatch(report, /pr #null/);
  assert.doesNotMatch(report, /issue #null/);
});

test('renderStatus renders a DAEMON_ERROR_KEY entry as a distinct daemon-error line and counts it as an attention item', () => {
  const dir = tmpDir();
  saveStore(dir, {
    [DAEMON_ERROR_KEY]: { branch: DAEMON_ERROR_KEY, pr: null, issue: null, status: 'retry', reason: 'runOnce-failed', diagnostic: 'boom', updatedAt: '2026-08-15T00:00:00.000Z' },
  });
  const report = renderStatus(dir);
  assert.match(report, /daemon error: retry \(reason=runOnce-failed.*boom/);
  assert.doesNotMatch(report, new RegExp(`${DAEMON_ERROR_KEY}: retry \\(pr #`));
  assert.match(report, /attention items: 1/);
});
