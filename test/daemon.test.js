import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runOnce, loop, DAEMON_ERROR_KEY } from '../src/daemon.js';
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

test('runOnce does nothing when resolveTerminalCandidate reports waiting', () => {
  const options = baseOptions({
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    mint: () => 'tok',
    findPRs: () => [],
    cleanup: () => { throw new Error('cleanup should not be called'); },
    log: () => {},
  });
  const store = runOnce(options);
  assert.deepEqual(store, {});
});

test('runOnce persists a pending candidate using the GitHub-resolved issue, not any branch-derived number, then invokes cleanup', () => {
  const options = baseOptions({
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 999, slug: 'demo' }], // deliberately wrong, must be ignored
    mint: () => 'tok',
    findPRs: () => [{ number: 5, state: 'MERGED', closingIssuesReferences: [{ number: 1 }] }],
    cleanup: (pr, issue) => {
      assert.equal(pr, 5);
      assert.equal(issue, 1); // GitHub-resolved, not 999
      return { status: 'cleaned', pr: '5', issue: '1', branch: 'agent/1-demo', merge_mode: 'regular', reason: 'cleanup-complete', diagnostic: '' };
    },
    log: () => {},
  });
  const store = runOnce(options);
  assert.equal(store['agent/1-demo'], undefined);
});

test('runOnce writes a permanent attention item on a token mint failure, with no retry', () => {
  const dir = tmpDir();
  let mintCalls = 0;
  const opts = () => baseOptions({
    stateDir: dir,
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    mint: () => { mintCalls += 1; throw new Error('token mint failed'); },
    findPRs: () => { throw new Error('should not be called'); },
    cleanup: () => { throw new Error('should not be called'); },
    log: () => {},
  });
  const store = runOnce(opts());
  assert.equal(store['agent/1-demo'].status, 'retry');
  assert.equal(store['agent/1-demo'].reason, 'token-mint-failed');
  assert.equal(mintCalls, 1);
  runOnce(opts());
  assert.equal(mintCalls, 1, 'no automatic retry once an attention item exists');
});

test('runOnce writes a permanent attention item on a PR lookup failure', () => {
  const options = baseOptions({
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    mint: () => 'tok',
    findPRs: () => { throw new Error('gh pr list failed'); },
    cleanup: () => { throw new Error('should not be called'); },
    log: () => {},
  });
  const store = runOnce(options);
  assert.equal(store['agent/1-demo'].status, 'retry');
  assert.equal(store['agent/1-demo'].reason, 'pr-lookup-failed');
});

test('runOnce writes a blocked attention item when resolveTerminalCandidate reports ambiguous', () => {
  const options = baseOptions({
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    mint: () => 'tok',
    findPRs: () => [
      { number: 3, state: 'CLOSED', closingIssuesReferences: [{ number: 1 }] },
      { number: 5, state: 'MERGED', closingIssuesReferences: [{ number: 1 }] },
    ],
    cleanup: () => { throw new Error('should not be called'); },
    log: () => {},
  });
  const store = runOnce(options);
  assert.equal(store['agent/1-demo'].status, 'blocked');
  assert.equal(store['agent/1-demo'].reason, 'pr-issue-ambiguous');
  assert.equal(store['agent/1-demo'].issue, null, 'an ambiguous result must not display a branch-derived issue number as confirmed');
});

test('runOnce refuses to resume a pending candidate with no pr identity, and blocks it instead of invoking cleanup', () => {
  const dir = tmpDir();
  saveStore(dir, {
    'agent/1-demo': { branch: 'agent/1-demo', pr: null, issue: null, status: 'pending', reason: null, diagnostic: null, updatedAt: 'x' },
  });
  const store = runOnce(baseOptions({
    stateDir: dir,
    discover: () => [],
    mint: () => { throw new Error('should not be called'); },
    findPRs: () => { throw new Error('should not be called'); },
    cleanup: () => { throw new Error('cleanup should not be called'); },
    log: () => {},
  }));
  assert.equal(store['agent/1-demo'].status, 'blocked');
  assert.equal(store['agent/1-demo'].reason, 'missing-pr-identity');
});

test('runOnce clears the candidate on already-clean', () => {
  const options = baseOptions({
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    mint: () => 'tok',
    findPRs: () => [{ number: 5, state: 'MERGED', closingIssuesReferences: [{ number: 1 }] }],
    cleanup: () => ({ status: 'already-clean', pr: '5', issue: '1', branch: 'agent/1-demo', merge_mode: null, reason: 'nothing-to-clean', diagnostic: '' }),
    log: () => {},
  });
  const store = runOnce(options);
  assert.equal(store['agent/1-demo'], undefined);
});

test('runOnce never re-invokes cleanup for a branch that already has an attention item', () => {
  const dir = tmpDir();
  let cleanupCalls = 0;
  const opts = () => baseOptions({
    stateDir: dir,
    discover: () => [{ path: '/wt/1', branch: 'agent/1-demo', issueNumber: 1, slug: 'demo' }],
    mint: () => 'tok',
    findPRs: () => [{ number: 5, state: 'MERGED', closingIssuesReferences: [{ number: 1 }] }],
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
    mint: () => { throw new Error('should not be called'); },
    findPRs: () => { throw new Error('should not be called'); },
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

test('loop persists a DAEMON_ERROR_KEY attention item when runOnce throws, and logs it', () => {
  const dir = tmpDir();
  const logs = [];
  const stop = loop({
    stateDir: dir,
    discover: () => { throw new Error('boom'); },
    mint: () => 'tok',
    findPRs: () => [],
    cleanup: () => { throw new Error('should not be called'); },
    log: (level, message) => logs.push({ level, message }),
    intervalMs: 10,
  });
  stop();
  const store = loadStore(dir);
  assert.equal(store[DAEMON_ERROR_KEY].status, 'retry');
  assert.equal(store[DAEMON_ERROR_KEY].reason, 'runOnce-failed');
  assert.match(store[DAEMON_ERROR_KEY].diagnostic, /boom/);
});

test('loop calls runOnce immediately and again after intervalMs, and stop() halts it', async () => {
  let calls = 0;
  const stop = loop({
    ...baseOptions(),
    discover: () => { calls += 1; return []; },
    mint: () => 'tok',
    findPRs: () => [],
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
