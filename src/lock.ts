import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from './security.js';

export function lockDatabase(dbPath: string) {
  if (dbPath === ':memory:') return () => {};
  const path = resolve(dbPath) + '.lock';
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  let fd: number;
  try { fd = openSync(path, 'wx', 0o600); } catch { throw new AppError('database_locked_or_unwritable'); }
  const owner = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
  try { writeFileSync(fd, owner); } finally { closeSync(fd); }
  return () => {
    // Do not remove another process's lock, or auto-remove a possibly live lock.
    if (readFileSync(path, 'utf8') === owner) unlinkSync(path);
  };
}
