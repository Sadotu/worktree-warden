import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mintToken, findPullRequestsForBranch, resolveTerminalCandidate } from '../src/github.js';

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

test('findPullRequestsForBranch requests closingIssuesReferences and returns the raw rows', () => {
  const run = (cmd, args, options) => {
    assert.equal(cmd, 'gh');
    assert.deepEqual(args, [
      'pr', 'list', '--repo', 'Sadotu/worktree-warden', '--head', 'agent/1-demo',
      '--state', 'all', '--json', 'number,state,closingIssuesReferences', '--limit', '20',
    ]);
    assert.equal(options.env.GH_TOKEN, 'ghs_faketoken');
    return {
      status: 0,
      stdout: JSON.stringify([{ number: 2, state: 'MERGED', closingIssuesReferences: [{ number: 1 }] }]),
      stderr: '',
    };
  };
  const rows = findPullRequestsForBranch('Sadotu/worktree-warden', 'agent/1-demo', 'ghs_faketoken', { run });
  assert.deepEqual(rows, [{ number: 2, state: 'MERGED', closingIssuesReferences: [{ number: 1 }] }]);
});

test('findPullRequestsForBranch returns [] when no PR exists', () => {
  const run = () => ({ status: 0, stdout: '[]', stderr: '' });
  const rows = findPullRequestsForBranch('Sadotu/worktree-warden', 'agent/1-demo', 'ghs_faketoken', { run });
  assert.deepEqual(rows, []);
});

test('findPullRequestsForBranch throws on gh failure', () => {
  const run = () => ({ status: 1, stdout: '', stderr: 'HTTP 401' });
  assert.throws(
    () => findPullRequestsForBranch('Sadotu/worktree-warden', 'agent/1-demo', 'ghs_faketoken', { run }),
    /gh pr list failed/
  );
});

test('resolveTerminalCandidate returns waiting for no rows', () => {
  assert.deepEqual(resolveTerminalCandidate([]), { kind: 'waiting' });
});

test('resolveTerminalCandidate returns waiting for only an OPEN row', () => {
  assert.deepEqual(resolveTerminalCandidate([{ number: 5, state: 'OPEN', closingIssuesReferences: [{ number: 1 }] }]), { kind: 'waiting' });
});

test('resolveTerminalCandidate resolves a single MERGED PR with exactly one linked issue', () => {
  const result = resolveTerminalCandidate([{ number: 5, state: 'MERGED', closingIssuesReferences: [{ number: 9 }] }]);
  assert.deepEqual(result, { kind: 'ready', number: 5, state: 'MERGED', issue: 9 });
});

test('resolveTerminalCandidate resolves a single CLOSED PR with exactly one linked issue', () => {
  const result = resolveTerminalCandidate([{ number: 5, state: 'CLOSED', closingIssuesReferences: [{ number: 9 }] }]);
  assert.deepEqual(result, { kind: 'ready', number: 5, state: 'CLOSED', issue: 9 });
});

test('resolveTerminalCandidate is ambiguous when more than one terminal PR exists', () => {
  const result = resolveTerminalCandidate([
    { number: 3, state: 'CLOSED', closingIssuesReferences: [{ number: 1 }] },
    { number: 5, state: 'MERGED', closingIssuesReferences: [{ number: 1 }] },
  ]);
  assert.equal(result.kind, 'ambiguous');
  assert.match(result.reason, /#3\(CLOSED\)/);
  assert.match(result.reason, /#5\(MERGED\)/);
});

test('resolveTerminalCandidate is ambiguous when the terminal PR has no linked issue', () => {
  const result = resolveTerminalCandidate([{ number: 5, state: 'MERGED', closingIssuesReferences: [] }]);
  assert.equal(result.kind, 'ambiguous');
  assert.match(result.reason, /no linked closing issue/);
});

test('resolveTerminalCandidate is ambiguous when the terminal PR links more than one issue', () => {
  const result = resolveTerminalCandidate([{ number: 5, state: 'MERGED', closingIssuesReferences: [{ number: 1 }, { number: 2 }] }]);
  assert.equal(result.kind, 'ambiguous');
  assert.match(result.reason, /closes multiple issues/);
});
