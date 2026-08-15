import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCleanup, classifyAfterRetries } from '../src/cleanup.js';

test('runCleanup reports cleaned on exit 0', () => {
  const run = (cmd, args) => {
    assert.equal(cmd, '/path/cleanup-merged.sh');
    assert.deepEqual(args, ['2', '1']);
    return { status: 0, stdout: '', stderr: '' };
  };
  assert.deepEqual(runCleanup('/path/cleanup-merged.sh', 2, 1, { run }), { outcome: 'cleaned', stderr: '' });
});

test('runCleanup reports blocked on a known guard-refusal message', () => {
  const run = () => ({ status: 1, stdout: '', stderr: 'Refusing to delete non-agent branch: main\n' });
  const result = runCleanup('/path/cleanup-merged.sh', 2, 1, { run });
  assert.equal(result.outcome, 'blocked');
});

test('runCleanup reports blocked for each known refusal pattern', () => {
  const messages = [
    'Cannot prove agent/1-demo landed in origin/main',
    'Artifact manifest is not a regular file: x',
    'Recorded artifact is missing or not a regular file: x',
    'Invalid artifact manifest path: x',
    'Duplicate artifact manifest path: x',
    'Unrecorded cleanup candidate: x; move/remove it manually',
  ];
  for (const message of messages) {
    const run = () => ({ status: 1, stdout: '', stderr: message });
    assert.equal(runCleanup('/path/cleanup-merged.sh', 2, 1, { run }).outcome, 'blocked', message);
  }
});

test('runCleanup reports retry for an unrecognized non-zero exit', () => {
  const run = () => ({ status: 1, stdout: '', stderr: '' });
  assert.equal(runCleanup('/path/cleanup-merged.sh', 2, 1, { run }).outcome, 'retry');
});

test('classifyAfterRetries leaves non-retry outcomes untouched', () => {
  assert.equal(classifyAfterRetries('cleaned', 10, 5), 'cleaned');
  assert.equal(classifyAfterRetries('blocked', 10, 5), 'blocked');
});

test('classifyAfterRetries escalates retry to blocked past the threshold', () => {
  assert.equal(classifyAfterRetries('retry', 4, 5), 'retry');
  assert.equal(classifyAfterRetries('retry', 5, 5), 'blocked');
  assert.equal(classifyAfterRetries('retry', 6, 5), 'blocked');
});
