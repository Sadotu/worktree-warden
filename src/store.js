import fs from 'node:fs';
import path from 'node:path';

export function loadStore(stateDir) {
  const file = path.join(stateDir, 'state.json');
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
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

export function setAttention(store, branch, { pr, issue, status, reason, diagnostic }) {
  return {
    ...store,
    [branch]: {
      branch, pr, issue, status, reason: reason ?? null, diagnostic: diagnostic ?? null,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function clearCandidate(store, branch) {
  const next = { ...store };
  delete next[branch];
  return next;
}
