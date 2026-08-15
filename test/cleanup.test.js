import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeCleanup } from '../src/cleanup.js';

function validRecord(overrides = {}) {
  return {
    status: 'cleaned', pr: '5', issue: '1', branch: 'agent/1-demo', merge_mode: 'regular', reason: 'cleanup-complete',
    ...overrides,
  };
}

test('invokeCleanup accepts a valid cleaned record with matching exit code 0', () => {
  const run = () => ({ status: 0, stdout: JSON.stringify(validRecord()), stderr: '' });
  const result = invokeCleanup('/path/cleanup-merged.sh', 5, 1, { run });
  assert.equal(result.status, 'cleaned');
  assert.equal(result.reason, 'cleanup-complete');
});

test('invokeCleanup accepts a valid blocked record with matching exit code 20', () => {
  const run = () => ({ status: 20, stdout: JSON.stringify(validRecord({ status: 'blocked', reason: 'worktree-dirty' })), stderr: 'diag\n' });
  const result = invokeCleanup('/path/cleanup-merged.sh', 5, 1, { run });
  assert.equal(result.status, 'blocked');
  assert.equal(result.diagnostic, 'diag');
});

test('invokeCleanup rejects a record whose exit code does not match its claimed status', () => {
  const run = () => ({ status: 1, stdout: JSON.stringify(validRecord()), stderr: '' }); // cleaned claims exit 0, actual is 1
  const result = invokeCleanup('/path/cleanup-merged.sh', 5, 1, { run });
  assert.equal(result.status, 'retry');
  assert.equal(result.reason, 'invalid-cleanup-output');
});

test('invokeCleanup rejects a record missing a required field', () => {
  const record = validRecord();
  delete record.merge_mode;
  const run = () => ({ status: 0, stdout: JSON.stringify(record), stderr: '' });
  const result = invokeCleanup('/path/cleanup-merged.sh', 5, 1, { run });
  assert.equal(result.status, 'retry');
  assert.equal(result.reason, 'invalid-cleanup-output');
});

test('invokeCleanup rejects a record with an unrecognized status value', () => {
  const run = () => ({ status: 0, stdout: JSON.stringify(validRecord({ status: 'success' })), stderr: '' });
  const result = invokeCleanup('/path/cleanup-merged.sh', 5, 1, { run });
  assert.equal(result.status, 'retry');
  assert.equal(result.reason, 'invalid-cleanup-output');
});

test('invokeCleanup rejects a record whose pr does not match the invoked pr', () => {
  const run = () => ({ status: 0, stdout: JSON.stringify(validRecord({ pr: '999' })), stderr: '' });
  const result = invokeCleanup('/path/cleanup-merged.sh', 5, 1, { run });
  assert.equal(result.status, 'retry');
  assert.equal(result.reason, 'invalid-cleanup-output');
});

test('invokeCleanup rejects a record whose issue does not match the invoked issue', () => {
  const run = () => ({ status: 0, stdout: JSON.stringify(validRecord({ issue: '999' })), stderr: '' });
  const result = invokeCleanup('/path/cleanup-merged.sh', 5, 1, { run });
  assert.equal(result.status, 'retry');
  assert.equal(result.reason, 'invalid-cleanup-output');
});

test('invokeCleanup synthesizes invocation-failed when stdout has no parseable JSON', () => {
  const run = () => ({ status: 127, stdout: '', stderr: 'bash: /path/cleanup-merged.sh: No such file or directory\n' });
  const result = invokeCleanup('/path/cleanup-merged.sh', 5, 1, { run });
  assert.equal(result.status, 'retry');
  assert.equal(result.reason, 'invocation-failed');
  assert.match(result.diagnostic, /No such file or directory/);
});

test('invokeCleanup synthesizes invocation-failed when stdout is present but not JSON', () => {
  const run = () => ({ status: 1, stdout: 'not json at all\n', stderr: '' });
  const result = invokeCleanup('/path/cleanup-merged.sh', 5, 1, { run });
  assert.equal(result.status, 'retry');
  assert.equal(result.reason, 'invocation-failed');
});
