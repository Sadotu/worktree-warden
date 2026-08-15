import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runOnce, loop } from '../src/daemon.js';
import { loadStore } from '../src/store.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warden-daemon-'));
}

function baseOptions(overrides = {}) {
  return {
    stateDir: tmpDir(),
    primaryWorkspace: '/fake/workspace',
    repoSlug: 'Sadotu/worktree-warden',
    cleanupScript: '/fake/cleanup-merged.sh',
    maxRetries: 3,
    ...overrides,
  };
}

test('runOnce marks an open PR as waiting and never invokes cleanup', () => {
  const cleanup = () => { throw new Error('cleanup should not be called'); };
  const options = baseOptions({
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    mint: () => 'tok',
    findPR: () => ({ number: 5, state: 'OPEN' }),
    cleanup,
    log: () => {},
  });
  const store = runOnce(options);
  assert.equal(store['agent/1-demo'].outcome, 'waiting');
});

test('runOnce ignores a closed-unmerged PR (no stored state)', () => {
  const options = baseOptions({
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    mint: () => 'tok',
    findPR: () => ({ number: 5, state: 'CLOSED' }),
    cleanup: () => { throw new Error('cleanup should not be called'); },
    log: () => {},
  });
  const store = runOnce(options);
  assert.equal(store['agent/1-demo'], undefined);
});

test('runOnce ignores branches with no PR at all', () => {
  const options = baseOptions({
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    mint: () => 'tok',
    findPR: () => null,
    cleanup: () => { throw new Error('cleanup should not be called'); },
    log: () => {},
  });
  const store = runOnce(options);
  assert.equal(store['agent/1-demo'].outcome, 'waiting');
});

test('runOnce records a retry on token mint failure and never calls findPR/cleanup', () => {
  const options = baseOptions({
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    mint: () => { throw new Error('token mint failed'); },
    findPR: () => { throw new Error('findPR should not be called'); },
    cleanup: () => { throw new Error('cleanup should not be called'); },
    log: () => {},
  });
  const store = runOnce(options);
  assert.equal(store['agent/1-demo'].outcome, 'retry');
  assert.equal(store['agent/1-demo'].retryCount, 1);
});

test('runOnce records a retry on PR lookup failure and never calls cleanup', () => {
  const options = baseOptions({
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    mint: () => 'tok',
    findPR: () => { throw new Error('gh pr list failed'); },
    cleanup: () => { throw new Error('cleanup should not be called'); },
    log: () => {},
  });
  const store = runOnce(options);
  assert.equal(store['agent/1-demo'].outcome, 'retry');
  assert.equal(store['agent/1-demo'].retryCount, 1);
});

test('runOnce invokes cleanup on a merged PR and clears state on success', () => {
  let cleanupCalls = 0;
  const options = baseOptions({
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    mint: () => 'tok',
    findPR: () => ({ number: 5, state: 'MERGED' }),
    cleanup: (pr, issue) => { cleanupCalls += 1; assert.equal(pr, 5); assert.equal(issue, 1); return { outcome: 'cleaned', stderr: '' }; },
    log: () => {},
  });
  const store = runOnce(options);
  assert.equal(cleanupCalls, 1);
  assert.equal(store['agent/1-demo'], undefined);
});

test('runOnce records a blocked outcome with attention set', () => {
  const options = baseOptions({
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    mint: () => 'tok',
    findPR: () => ({ number: 5, state: 'MERGED' }),
    cleanup: () => ({ outcome: 'blocked', stderr: 'Refusing to delete non-agent branch' }),
    log: () => {},
  });
  const store = runOnce(options);
  assert.equal(store['agent/1-demo'].outcome, 'blocked');
  assert.equal(store['agent/1-demo'].attention, true);
});

test('runOnce escalates retry to blocked once maxRetries is reached, and does not repeat cleanup once blocked', () => {
  const dir = tmpDir();
  let cleanupCalls = 0;
  const options = () => baseOptions({
    stateDir: dir,
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    mint: () => 'tok',
    findPR: () => ({ number: 5, state: 'MERGED' }),
    cleanup: () => { cleanupCalls += 1; return { outcome: 'retry', stderr: '' }; },
    log: () => {},
    maxRetries: 3,
  });
  let store;
  for (let i = 0; i < 3; i++) store = runOnce(options());
  assert.equal(store['agent/1-demo'].outcome, 'blocked');
  assert.equal(cleanupCalls, 3);
  store = runOnce(options());
  assert.equal(cleanupCalls, 3, 'cleanup must not be invoked again once blocked');
});

test('runOnce is idempotent across restarts: a branch that disappears from discovery after cleanup is not re-processed', () => {
  const dir = tmpDir();
  let cleanupCalls = 0;
  const worktrees = [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }];
  const run1 = runOnce(baseOptions({
    stateDir: dir,
    discover: () => worktrees,
    mint: () => 'tok',
    findPR: () => ({ number: 5, state: 'MERGED' }),
    cleanup: () => { cleanupCalls += 1; return { outcome: 'cleaned', stderr: '' }; },
    log: () => {},
  }));
  assert.equal(run1['agent/1-demo'], undefined);
  assert.equal(cleanupCalls, 1);

  // Restart: fresh process would reload the store from disk. Worktree is gone now.
  const reloaded = loadStore(dir);
  assert.equal(reloaded['agent/1-demo'], undefined);

  const run2 = runOnce(baseOptions({
    stateDir: dir,
    discover: () => [], // worktree/branch no longer exist
    mint: () => 'tok',
    findPR: () => { throw new Error('should not be called — nothing discovered'); },
    cleanup: () => { throw new Error('should not be called — nothing discovered'); },
    log: () => {},
  }));
  assert.deepEqual(run2, {});
  assert.equal(cleanupCalls, 1, 'cleanup must not run a second time for an already-cleaned branch');
});

test('runOnce escalates persistent token-mint (connectivity) failures to blocked after maxRetries cycles', () => {
  const dir = tmpDir();
  let mintCalls = 0;
  const options = () => baseOptions({
    stateDir: dir,
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    mint: () => { mintCalls += 1; throw new Error('token mint failed'); },
    findPR: () => { throw new Error('findPR should not be called'); },
    cleanup: () => { throw new Error('cleanup should not be called'); },
    log: () => {},
    maxRetries: 3,
  });
  let store;
  for (let i = 0; i < 3; i++) store = runOnce(options());
  assert.equal(store['agent/1-demo'].outcome, 'blocked');
  assert.equal(store['agent/1-demo'].attention, true);
  assert.equal(mintCalls, 3);
  // Once blocked, the branch is skipped entirely — mint should not be called again.
  store = runOnce(options());
  assert.equal(mintCalls, 3, 'mint must not be invoked again once blocked');
});

test('runOnce does not pre-charge cleanup retries with prior connectivity-failure retries', () => {
  const dir = tmpDir();
  const options = (overrides) => baseOptions({
    stateDir: dir,
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    log: () => {},
    maxRetries: 5,
    ...overrides,
  });

  // Build up connectivity-failure retryCount over a few cycles.
  let store;
  for (let i = 0; i < 3; i++) {
    store = runOnce(options({
      mint: () => { throw new Error('token mint failed'); },
      findPR: () => { throw new Error('findPR should not be called'); },
      cleanup: () => { throw new Error('cleanup should not be called'); },
    }));
  }
  assert.equal(store['agent/1-demo'].outcome, 'retry');
  assert.equal(store['agent/1-demo'].retryKind, 'connectivity');
  assert.equal(store['agent/1-demo'].retryCount, 3);

  // Now the PR merges and cleanup itself returns a single retry — the
  // cleanup retryCount must reset to 1, not continue from 3.
  store = runOnce(options({
    mint: () => 'tok',
    findPR: () => ({ number: 5, state: 'MERGED' }),
    cleanup: () => ({ outcome: 'retry', stderr: '' }),
  }));
  assert.equal(store['agent/1-demo'].outcome, 'retry');
  assert.equal(store['agent/1-demo'].retryKind, 'cleanup');
  assert.equal(store['agent/1-demo'].retryCount, 1);
});

test('runOnce logs a warning when a branch in retry/blocked state disappears from discovery', () => {
  const dir = tmpDir();
  const logs = [];
  const worktrees = [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }];

  // First cycle: leave the branch in 'retry' state (cleanup keeps failing).
  runOnce(baseOptions({
    stateDir: dir,
    discover: () => worktrees,
    mint: () => 'tok',
    findPR: () => ({ number: 5, state: 'MERGED' }),
    cleanup: () => ({ outcome: 'retry', stderr: '' }),
    log: (level, message) => logs.push({ level, message }),
    maxRetries: 5,
  }));

  // Second cycle: the branch/worktree has vanished entirely.
  const store = runOnce(baseOptions({
    stateDir: dir,
    discover: () => [],
    mint: () => 'tok',
    findPR: () => { throw new Error('should not be called'); },
    cleanup: () => { throw new Error('should not be called'); },
    log: (level, message) => logs.push({ level, message }),
    maxRetries: 5,
  }));

  assert.equal(store['agent/1-demo'], undefined);
  assert.ok(
    logs.some((l) => l.message.includes('disappeared') && l.message.includes('agent/1-demo')),
    'expected a warning log mentioning the disappeared branch'
  );
});

test('loop calls runOnce immediately and again after intervalMs, and stop() halts it', async () => {
  let calls = 0;
  const stop = loop({
    ...baseOptions(),
    discover: () => { calls += 1; return []; },
    mint: () => 'tok',
    findPR: () => null,
    cleanup: () => ({ outcome: 'cleaned', stderr: '' }),
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
