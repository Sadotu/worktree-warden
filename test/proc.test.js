import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/proc.js';

test('run surfaces the spawn error message in stderr when the binary cannot be found', () => {
  const result = run('definitely-not-a-real-command-xyz', []);
  assert.notEqual(result.status, 0);
  assert.ok(result.error, 'expected an error to be set');
  assert.ok(result.stderr.includes(result.error.message), 'stderr should include the spawn error message');
  assert.ok(result.stderr.includes('ENOENT') || result.stderr.length > 0, 'stderr should be non-empty');
});

test('run returns normal output for a real, successful command', () => {
  const result = run('node', ['-e', 'console.log("ok")']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'ok');
  assert.equal(result.stderr, '');
  assert.equal(result.error, undefined);
});
