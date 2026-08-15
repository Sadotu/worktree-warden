import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runOnce, loop } from '../src/daemon.js';
import { loadStore, saveStore } from '../src/store.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warden-daemon-'));
}

function baseOptions(overrides = {}) {
  return {
    stateDir: tmpDir(),
    primaryWorkspace: '/fake/workspace',
    repoSlug: 'Sadotu/worktree-warden',
    cleanupScript: '/fake/cleanup-merged.sh',
    ...overrides,
  };
}

test('runOnce does nothing for an open PR — no store entry written', () => {
  const options = baseOptions({
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    mint: () => 'tok',
    findPR: () => ({ number: 5, state: 'OPEN' }),
    cleanup: () => { throw new Error('cleanup should not be called'); },
    log: () => {},
  });
  const store = runOnce(options);
  assert.deepEqual(store, {});
});

test('runOnce does nothing when no PR exists yet', () => {
  const options = baseOptions({
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    mint: () => 'tok',
    findPR: () => null,
    cleanup: () => { throw new Error('cleanup should not be called'); },
    log: () => {},
  });
  const store = runOnce(options);
  assert.deepEqual(store, {});
});

test('runOnce persists a pending candidate before invoking cleanup for a merged PR', () => {
  const options = baseOptions({
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    mint: () => 'tok',
    findPR: () => ({ number: 5, state: 'MERGED' }),
    cleanup: (pr, issue) => {
      const persistedBeforeInvoking = loadStore(options.stateDir)['agent/1-demo'];
      assert.equal(persistedBeforeInvoking.status, 'pending');
      assert.equal(persistedBeforeInvoking.pr, 5);
      assert.equal(pr, 5);
      assert.equal(issue, 1);
      return { status: 'cleaned', pr: '5', issue: '1', branch: 'agent/1-demo', merge_mode: 'regular', reason: 'cleanup-complete', diagnostic: '' };
    },
    log: () => {},
  });
  const store = runOnce(options);
  assert.equal(store['agent/1-demo'], undefined);
});

test('runOnce also invokes cleanup for a closed, unmerged PR', () => {
  let cleanupCalls = 0;
  const options = baseOptions({
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    mint: () => 'tok',
    findPR: () => ({ number: 5, state: 'CLOSED' }),
    cleanup: (pr, issue) => {
      cleanupCalls += 1;
      assert.equal(pr, 5);
      assert.equal(issue, 1);
      return { status: 'cleaned', pr: '5', issue: '1', branch: 'agent/1-demo', merge_mode: null, reason: 'closed-unmerged-cleanup-complete', diagnostic: '' };
    },
    log: () => {},
  });
  const store = runOnce(options);
  assert.equal(cleanupCalls, 1);
  assert.equal(store['agent/1-demo'], undefined);
});

test('runOnce clears the candidate on already-clean', () => {
  const options = baseOptions({
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    mint: () => 'tok',
    findPR: () => ({ number: 5, state: 'MERGED' }),
    cleanup: () => ({ status: 'already-clean', pr: '5', issue: '1', branch: 'agent/1-demo', merge_mode: null, reason: 'nothing-to-clean', diagnostic: '' }),
    log: () => {},
  });
  const store = runOnce(options);
  assert.equal(store['agent/1-demo'], undefined);
});

test('runOnce records an attention item on blocked, with no retry bookkeeping at all', () => {
  const options = baseOptions({
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    mint: () => 'tok',
    findPR: () => ({ number: 5, state: 'MERGED' }),
    cleanup: () => ({ status: 'blocked', pr: '5', issue: '1', branch: 'agent/1-demo', merge_mode: null, reason: 'worktree-dirty', diagnostic: 'uncommitted changes' }),
    log: () => {},
  });
  const store = runOnce(options);
  assert.equal(store['agent/1-demo'].status, 'blocked');
  assert.equal(store['agent/1-demo'].reason, 'worktree-dirty');
  assert.equal(store['agent/1-demo'].diagnostic, 'uncommitted changes');
  assert.equal('retryCount' in store['agent/1-demo'], false);
  assert.equal('attention' in store['agent/1-demo'], false);
});

test('runOnce never re-invokes cleanup for a branch that already has an attention item', () => {
  const dir = tmpDir();
  let cleanupCalls = 0;
  const opts = () => baseOptions({
    stateDir: dir,
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    mint: () => 'tok',
    findPR: () => ({ number: 5, state: 'MERGED' }),
    cleanup: () => { cleanupCalls += 1; return { status: 'retry', pr: '5', issue: '1', branch: 'agent/1-demo', merge_mode: null, reason: 'fetch-failed', diagnostic: '' }; },
    log: () => {},
  });
  runOnce(opts());
  assert.equal(cleanupCalls, 1);
  runOnce(opts());
  assert.equal(cleanupCalls, 1, 'no automatic retry once an attention item exists');
});

test('runOnce resumes a pending candidate on the next cycle even if its worktree has vanished from discovery', () => {
  const dir = tmpDir();
  let cleanupCalls = 0;
  saveStore(dir, {
    'agent/1-demo': { branch: 'agent/1-demo', pr: '5', issue: '1', status: 'pending', reason: null, diagnostic: null, updatedAt: 'x' },
  });
  const store = runOnce(baseOptions({
    stateDir: dir,
    discover: () => [],
    mint: () => { throw new Error('should not be called — candidate is already known to be terminal'); },
    findPR: () => { throw new Error('should not be called — candidate is already known to be terminal'); },
    cleanup: (pr, issue) => {
      cleanupCalls += 1;
      assert.equal(pr, '5');
      assert.equal(issue, '1');
      return { status: 'already-clean', pr: '5', issue: '1', branch: 'agent/1-demo', merge_mode: null, reason: 'nothing-to-clean', diagnostic: '' };
    },
    log: () => {},
  }));
  assert.equal(cleanupCalls, 1);
  assert.equal(store['agent/1-demo'], undefined);
});

test('runOnce leaves an existing attention item alone even if its worktree has vanished from discovery', () => {
  const dir = tmpDir();
  saveStore(dir, {
    'agent/1-demo': { branch: 'agent/1-demo', pr: '5', issue: '1', status: 'blocked', reason: 'worktree-dirty', diagnostic: 'x', updatedAt: 'x' },
  });
  const store = runOnce(baseOptions({
    stateDir: dir,
    discover: () => [],
    mint: () => { throw new Error('should not be called'); },
    findPR: () => { throw new Error('should not be called'); },
    cleanup: () => { throw new Error('should not be called — no automatic retry'); },
    log: () => {},
  }));
  assert.equal(store['agent/1-demo'].status, 'blocked');
});

test('runOnce logs and skips (writing no state) on a token mint failure', () => {
  const options = baseOptions({
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    mint: () => { throw new Error('token mint failed'); },
    findPR: () => { throw new Error('should not be called'); },
    cleanup: () => { throw new Error('should not be called'); },
    log: () => {},
  });
  const store = runOnce(options);
  assert.deepEqual(store, {});
});

test('runOnce logs and skips (writing no state) on a PR lookup failure', () => {
  const options = baseOptions({
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    mint: () => 'tok',
    findPR: () => { throw new Error('gh pr list failed'); },
    cleanup: () => { throw new Error('should not be called'); },
    log: () => {},
  });
  const store = runOnce(options);
  assert.deepEqual(store, {});
});

test('loop calls runOnce immediately and again after intervalMs, and stop() halts it', async () => {
  let calls = 0;
  const stop = loop({
    ...baseOptions(),
    discover: () => { calls += 1; return []; },
    mint: () => 'tok',
    findPR: () => null,
    cleanup: () => ({ status: 'cleaned', pr: '1', issue: '1', branch: 'x', merge_mode: null, reason: 'x', diagnostic: '' }),
    log: () => {},
    intervalMs: 10,
  });
  await new Promise((resolve) => setTimeout(resolve, 35));
  stop();
  const callsAtStop = calls;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(callsAtStop >= 2, `expected at least 2 calls, got ${callsAtStop}`);
  assert.equal(calls, callsAtStop, 'stop() must prevent further ticks');
});
