import fs from 'node:fs';
import { run as defaultRun } from './proc.js';

const EXIT_CODE_FOR_STATUS = { cleaned: 0, 'already-clean': 0, waiting: 10, blocked: 20, retry: 30 };
const REQUIRED_FIELDS = ['pr', 'issue', 'branch', 'merge_mode', 'reason'];

function isValidRecord(record, exitCode, expectedPr, expectedIssue) {
  if (!record || typeof record !== 'object') return false;
  if (!(record.status in EXIT_CODE_FOR_STATUS)) return false;
  for (const field of REQUIRED_FIELDS) {
    if (!(field in record)) return false;
  }
  if (exitCode !== EXIT_CODE_FOR_STATUS[record.status]) return false;
  if (String(record.pr) !== String(expectedPr)) return false;
  if (String(record.issue) !== String(expectedIssue)) return false;
  return true;
}

export function invokeCleanup(scriptPath, prNumber, issueNumber, opts = {}) {
  const run = opts.run ?? defaultRun;
  const exists = opts.exists ?? fs.existsSync;

  if (!exists(scriptPath)) {
    return {
      status: 'retry',
      pr: String(prNumber),
      issue: String(issueNumber),
      branch: null,
      merge_mode: null,
      reason: 'cleanup-script-not-found',
      diagnostic: `no cleanup script at ${scriptPath}; set WARDEN_CLEANUP_SCRIPT to point at a github-pr-cleanup cleanup.sh (see README)`,
    };
  }

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

  if (record && isValidRecord(record, result.status, prNumber, issueNumber)) {
    return {
      status: record.status,
      pr: record.pr,
      issue: record.issue,
      branch: record.branch,
      merge_mode: record.merge_mode,
      reason: record.reason,
      diagnostic,
    };
  }

  return {
    status: 'retry',
    pr: String(prNumber),
    issue: String(issueNumber),
    branch: null,
    merge_mode: null,
    reason: record ? 'invalid-cleanup-output' : 'invocation-failed',
    diagnostic: diagnostic || (record
      ? 'cleanup script produced output that failed contract validation'
      : 'cleanup script produced no parseable output'),
  };
}
