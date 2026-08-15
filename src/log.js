import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 1024 * 1024;
const TRIM_TO_BYTES = 512 * 1024;

function logFilePath(stateDir) {
  return path.join(stateDir, 'warden.log');
}

export function appendLog(stateDir, level, message) {
  fs.mkdirSync(stateDir, { recursive: true });
  const file = logFilePath(stateDir);
  fs.appendFileSync(file, `${new Date().toISOString()} [${level}] ${message}\n`);
  boundLogFile(file);
}

function boundLogFile(file) {
  const { size } = fs.statSync(file);
  if (size <= MAX_BYTES) return;
  const content = fs.readFileSync(file, 'utf8');
  const trimmed = content.slice(-TRIM_TO_BYTES);
  const firstNewline = trimmed.indexOf('\n');
  fs.writeFileSync(file, firstNewline === -1 ? trimmed : trimmed.slice(firstNewline + 1));
}

export function readLogTail(stateDir, maxLines = 20) {
  const file = logFilePath(stateDir);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  return lines.slice(-maxLines);
}
