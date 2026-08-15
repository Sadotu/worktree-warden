import { run as defaultRun } from './proc.js';

export function invokeCleanup(scriptPath, prNumber, issueNumber, opts = {}) {
  const run = opts.run ?? defaultRun;
  const result = run(scriptPath, [String(prNumber), String(issueNumber)], {});
  const stdout = (result.stdout ?? '').trim();
  const diagnostic = (result.stderr ?? '').trim();

  let record = null;
  if (stdout) {
    try {
      record = JSON.parse(stdout);
    } catch {
      record = null;
    }
  }

  if (record && typeof record.status === 'string') {
    return {
      status: record.status,
      pr: record.pr ?? String(prNumber),
      issue: record.issue ?? String(issueNumber),
      branch: record.branch ?? null,
      merge_mode: record.merge_mode ?? null,
      reason: record.reason ?? null,
      diagnostic,
    };
  }

  return {
    status: 'retry',
    pr: String(prNumber),
    issue: String(issueNumber),
    branch: null,
    merge_mode: null,
    reason: 'invocation-failed',
    diagnostic: diagnostic || 'cleanup script produced no parseable output',
  };
}
