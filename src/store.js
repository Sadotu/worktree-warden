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

export function getBranchState(store, branch) {
  return store[branch] ?? { outcome: null, retryCount: 0, retryKind: null, attention: false, updatedAt: null };
}

export function setBranchState(store, branch, patch) {
  return {
    ...store,
    [branch]: { ...getBranchState(store, branch), ...patch, updatedAt: new Date().toISOString() },
  };
}

export function clearBranchState(store, branch) {
  const next = { ...store };
  delete next[branch];
  return next;
}
