import fs from 'node:fs';
import path from 'node:path';

function lockFilePath(stateDir) {
  return path.join(stateDir, 'warden.pid');
}

export function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

export function acquireLock(stateDir, pid = process.pid) {
  fs.mkdirSync(stateDir, { recursive: true });
  const file = lockFilePath(stateDir);
  if (fs.existsSync(file)) {
    const existingPid = Number(fs.readFileSync(file, 'utf8').trim());
    if (isProcessAlive(existingPid)) {
      throw new Error(`another worktree-warden instance is already running (pid ${existingPid})`);
    }
  }
  fs.writeFileSync(file, String(pid));
  return file;
}

export function releaseLock(stateDir, pid = process.pid) {
  const file = lockFilePath(stateDir);
  if (!fs.existsSync(file)) return;
  const existingPid = Number(fs.readFileSync(file, 'utf8').trim());
  if (existingPid === pid) fs.unlinkSync(file);
}

export function readLock(stateDir) {
  const file = lockFilePath(stateDir);
  if (!fs.existsSync(file)) return null;
  const pid = Number(fs.readFileSync(file, 'utf8').trim());
  return { pid, alive: isProcessAlive(pid) };
}
