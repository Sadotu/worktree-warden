import { run as defaultRun } from './proc.js';

// Compatibility adapter for cleanup-merged.sh's current plain exit-code/stderr
// output. Replace with parsing agent-skills#28's structured result once it
// ships — see docs/superpowers/specs/2026-08-15-merged-pr-watch-daemon-design.md.
const BLOCKED_PATTERNS = [
  /Refusing to delete non-agent branch/,
  /Cannot prove/,
  /Artifact manifest/,
  /Recorded artifact/,
  /Invalid artifact manifest/,
  /Duplicate artifact manifest/,
  /Unrecorded cleanup candidate/,
];

export function runCleanup(scriptPath, prNumber, issueNumber, opts = {}) {
  const run = opts.run ?? defaultRun;
  const result = run(scriptPath, [String(prNumber), String(issueNumber)], {});
  if (result.status === 0) {
    return { outcome: 'cleaned', stderr: result.stderr ?? '' };
  }
  const stderr = result.stderr ?? '';
  const blocked = BLOCKED_PATTERNS.some((pattern) => pattern.test(stderr));
  return { outcome: blocked ? 'blocked' : 'retry', stderr };
}

export function classifyAfterRetries(outcome, retryCount, maxRetries) {
  if (outcome === 'retry' && retryCount >= maxRetries) return 'blocked';
  return outcome;
}
