import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeCleanup } from '../src/cleanup.js';

test('invokeCleanup parses a cleaned JSON record', () => {
  const run = (cmd, args) => {
    assert.equal(cmd, '/path/cleanup-merged.sh');
    assert.deepEqual(args, ['5', '1']);
    return {
      status: 0,
      stdout: '{"status":"cleaned","pr":"5","issue":"1","branch":"agent/1-demo","merge_mode":"regular","reason":"cleanup-complete"}\n',
      stderr: '',
    };
  };
  const result = invokeCleanup('/path/cleanup-merged.sh', 5, 1, { run });
  assert.equal(result.status, 'cleaned');
  assert.equal(result.pr, '5');
  assert.equal(result.issue, '1');
  assert.equal(result.branch, 'agent/1-demo');
  assert.equal(result.merge_mode, 'regular');
  assert.equal(result.reason, 'cleanup-complete');
  assert.equal(result.diagnostic, '');
});

test('invokeCleanup parses an already-clean record', () => {
  const run = () => ({
    status: 0,
    stdout: '{"status":"already-clean","pr":"5","issue":"1","branch":"agent/1-demo","merge_mode":null,"reason":"nothing-to-clean"}\n',
    stderr: '',
  });
  const result = invokeCleanup('/path/cleanup-merged.sh', 5, 1, { run });
  assert.equal(result.status, 'already-clean');
});

test('invokeCleanup parses a blocked record with a human diagnostic on stderr', () => {
  const run = () => ({
    status: 20,
    stdout: '{"status":"blocked","pr":"5","issue":"1","branch":"agent/1-demo","merge_mode":null,"reason":"worktree-dirty"}\n',
    stderr: 'Worktree /path has uncommitted changes\n',
  });
  const result = invokeCleanup('/path/cleanup-merged.sh', 5, 1, { run });
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'worktree-dirty');
  assert.equal(result.diagnostic, 'Worktree /path has uncommitted changes');
});

test('invokeCleanup parses a retry record', () => {
  const run = () => ({
    status: 30,
    stdout: '{"status":"retry","pr":"5","issue":"1","branch":"agent/1-demo","merge_mode":null,"reason":"fetch-failed"}\n',
    stderr: 'unable to fetch from origin\n',
  });
  const result = invokeCleanup('/path/cleanup-merged.sh', 5, 1, { run });
  assert.equal(result.status, 'retry');
  assert.equal(result.reason, 'fetch-failed');
});

test('invokeCleanup synthesizes a retry result when the process failed to spawn', () => {
  const run = () => ({ status: 127, stdout: '', stderr: 'bash: /path/cleanup-merged.sh: No such file or directory\n' });
  const result = invokeCleanup('/path/cleanup-merged.sh', 5, 1, { run });
  assert.equal(result.status, 'retry');
  assert.equal(result.reason, 'invocation-failed');
  assert.match(result.diagnostic, /No such file or directory/);
  assert.equal(result.pr, '5');
  assert.equal(result.issue, '1');
});

test('invokeCleanup synthesizes a retry result when stdout is present but not JSON', () => {
  const run = () => ({ status: 1, stdout: 'not json at all\n', stderr: '' });
  const result = invokeCleanup('/path/cleanup-merged.sh', 5, 1, { run });
  assert.equal(result.status, 'retry');
  assert.equal(result.reason, 'invocation-failed');
});

test('invokeCleanup gives a generic diagnostic when both stdout and stderr are empty', () => {
  const run = () => ({ status: 1, stdout: '', stderr: '' });
  const result = invokeCleanup('/path/cleanup-merged.sh', 5, 1, { run });
  assert.equal(result.status, 'retry');
  assert.match(result.diagnostic, /no parseable output/);
});
