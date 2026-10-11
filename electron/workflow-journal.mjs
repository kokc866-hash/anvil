import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

// Shared validation is intentionally independent of Node I/O; browser bundlers
// use the validator entry below instead of importing this persistence adapter.
export { validWorkflowSnapshot } from './workflow-validation.mjs';
import { validWorkflowSnapshot } from './workflow-validation.mjs';

export function writeWorkflowJournal(path, snapshot) {
  if (!validWorkflowSnapshot(snapshot)) throw new Error('Ungültiger Ablaufzustand.');
  const raw = JSON.stringify(snapshot);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + '.tmp';
  const fd = openSync(temporary, 'w', 0o600);
  try { writeFileSync(fd, raw); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, path);
  return { ok: true };
}

export function workflowJournalPath(root, project, id) {
  if (typeof project !== 'string' || project.length > 4096 || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('Ungültige Ablaufkennung.');
  const scope = createHash('sha256').update(project).digest('hex');
  return join(root, scope, id + '.json');
}

export function readWorkflowJournal(path) {
  try { const snapshot = JSON.parse(readFileSync(path, 'utf8')); return validWorkflowSnapshot(snapshot) ? snapshot : null; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
