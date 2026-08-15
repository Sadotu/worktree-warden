import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mintToken, findPullRequestForBranch } from '../src/github.js';

test('mintToken returns the trimmed stdout on success', () => {
  const run = (cmd, args, options) => {
    assert.equal(cmd, '/tmp/fake-helper.sh');
    assert.equal(options.env.GITHUB_APP_REPO, 'Sadotu/worktree-warden');
    return { status: 0, stdout: 'ghs_faketoken\n', stderr: '' };
  };
  const token = mintToken('Sadotu/worktree-warden', { run, helperPath: '/tmp/fake-helper.sh' });
  assert.equal(token, 'ghs_faketoken');
});

test('mintToken throws on non-zero exit', () => {
  const run = () => ({ status: 1, stdout: '', stderr: 'could not resolve installation id' });
  assert.throws(
    () => mintToken('Sadotu/worktree-warden', { run, helperPath: '/tmp/fake-helper.sh' }),
    /failed to mint GitHub App token/
  );
});

test('mintToken throws on empty token', () => {
  const run = () => ({ status: 0, stdout: '\n', stderr: '' });
  assert.throws(
    () => mintToken('Sadotu/worktree-warden', { run, helperPath: '/tmp/fake-helper.sh' }),
    /failed to mint GitHub App token/
  );
});

test('findPullRequestForBranch returns the first matching PR', () => {
  const run = (cmd, args, options) => {
    assert.equal(cmd, 'gh');
    assert.deepEqual(args, [
      'pr', 'list', '--repo', 'Sadotu/worktree-warden', '--head', 'agent/1-demo',
      '--state', 'all', '--json', 'number,state', '--limit', '1',
    ]);
    assert.equal(options.env.GH_TOKEN, 'ghs_faketoken');
    return { status: 0, stdout: '[{"number":2,"state":"MERGED"}]', stderr: '' };
  };
  const pr = findPullRequestForBranch('Sadotu/worktree-warden', 'agent/1-demo', 'ghs_faketoken', { run });
  assert.deepEqual(pr, { number: 2, state: 'MERGED' });
});

test('findPullRequestForBranch returns null when no PR exists', () => {
  const run = () => ({ status: 0, stdout: '[]', stderr: '' });
  const pr = findPullRequestForBranch('Sadotu/worktree-warden', 'agent/1-demo', 'ghs_faketoken', { run });
  assert.equal(pr, null);
});

test('findPullRequestForBranch throws on gh failure', () => {
  const run = () => ({ status: 1, stdout: '', stderr: 'HTTP 401' });
  assert.throws(
    () => findPullRequestForBranch('Sadotu/worktree-warden', 'agent/1-demo', 'ghs_faketoken', { run }),
    /gh pr list failed/
  );
});
