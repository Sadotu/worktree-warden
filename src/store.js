import fs from 'node:fs';
import path from 'node:path';

export function loadStore(stateDir) {
  const file = path.join(stateDir, 'state.json');
  if (!fs.existsSync(file)) return {};
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
  const filtered = {};
  for (const [branch, entry] of Object.entries(parsed)) {
    if (entry && typeof entry.status === 'string') {
      filtered[branch] = entry;
    }
  }
  return filtered;
}

export function saveStore(stateDir, store) {
  fs.mkdirSync(stateDir, { recursive: true });
  const file = path.join(stateDir, 'state.json');
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, file);
}

export function getCandidate(store, branch) {
  return store[branch] ?? null;
}

export function setPending(store, branch, { pr, issue }) {
  return {
    ...store,
    [branch]: {
      branch, pr, issue, status: 'pending', reason: null, diagnostic: null,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function setAttention(store, branch, {
  pr, issue, status, reason, diagnostic, attempt = null, nextRetryAt = null,
}) {
  return {
    ...store,
    [branch]: {
      branch, pr, issue, status, reason: reason ?? null, diagnostic: diagnostic ?? null,
      attempt, nextRetryAt,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function clearCandidate(store, branch) {
  const next = { ...store };
  delete next[branch];
  return next;
}
