/** Managed, local-only task checkouts. No merge/reset/clean. Raw blob checkout avoids filters. */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gitBin, resolveCwd } from './git.mjs';
import { anvilHome } from './paths.mjs';
import { toolEnv } from './toolchain.mjs';
import { hasAsciiControl } from '../electron/text-controls.mjs';

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 4000;
const validId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
const hash = value => createHash('sha256').update(value).digest('hex');
const canonicalKey = p => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
const samePath = (a, b) => canonicalKey(a) === canonicalKey(b);
const within = (root, p) => samePath(root, p) || canonicalKey(p).startsWith(canonicalKey(root) + path.sep);
const identity = p => { const s = statSync(p); return `${s.dev}:${s.ino}`; };
const aborted = signal => signal?.throwIfAborted();

export function safeWorktreePath(p) {
  return typeof p === 'string' && p.length > 0 && p.length < 1024 && !/[\\:*?"<>|]/.test(p) && !hasAsciiControl(p)
    && p.split('/').every(part => part && !['.', '..', '__proto__', 'constructor', 'prototype'].includes(part) && !/^\.git(?:$|[. ])/i.test(part)
      && !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

function checkedTarget(root, rel) {
  if (!safeWorktreePath(rel)) throw Error('Ungültiger oder reservierter Dateipfad.');
  if (!samePath(realpathSync(root), root)) throw Error('Projektordner wurde verschoben oder durch eine Verknüpfung ersetzt.');
  let full = root;
  for (const part of rel.split('/')) {
    full = path.join(full, part);
    try {
      const st = lstatSync(full);
      if (st.isSymbolicLink()) throw Error('Verknüpfung im Dateipfad; Datei bleibt unverändert.');
      if (full !== path.join(root, rel) && !st.isDirectory()) throw Error('Ein Elternpfad ist keine Verzeichnisstruktur.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!within(root, full)) throw Error('Pfad verlässt den Projektordner.');
  return full;
}

/** Abort resolves only after child exit. Used for Git and a real-process cancellation test. */
export function runWorktreeProcess(file, args, { cwd, signal, input, timeoutMs = 30000, maxBytes = MAX_BYTES } = {}) {
  aborted(signal);
  return new Promise((resolve, reject) => {
    const env = { ...toolEnv(), GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1' };
    // Parent Git context must never redirect this operation to another index/repository.
    for (const key of Object.keys(env)) if (/^GIT_(?:DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG(?:_|$))/.test(key)) delete env[key];
    const child = spawn(file, args, { cwd, env, shell: false, windowsHide: true });
    const out = [], err = []; let bytes = 0, errBytes = 0, failure, settled = false, killTimer;
    const terminate = error => {
      if (failure) return;
      failure = error; child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1200); killTimer.unref?.();
    };
    const abort = () => terminate(signal.reason instanceof Error ? signal.reason : new DOMException('Git-Aktion abgebrochen.', 'AbortError'));
    const timer = setTimeout(() => terminate(Error('Git-Aktion überschreitet das Zeitlimit.')), timeoutMs);
    const cleanup = () => { settled = true; clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort); };
    child.stdout?.on('data', chunk => { bytes += chunk.length; if (bytes > maxBytes) terminate(Error('Git-Ergebnis überschreitet die Größenbegrenzung.')); else out.push(chunk); });
    child.stderr?.on('data', chunk => { if (errBytes < 64000) { err.push(chunk.subarray(0, 64000 - errBytes)); errBytes += chunk.length; } });
    child.on('error', error => { if (!settled) { cleanup(); reject(error); } });
    child.on('close', code => { if (settled) return; cleanup(); if (failure) reject(failure); else resolve({ code, ok: code === 0, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') }); });
    child.stdin?.on('error', () => { /* Process failure is reported by close. */ });
    if (input !== undefined) child.stdin.end(input); else child.stdin?.end();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`, fd = openSync(tmp, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
  try { renameSync(tmp, file); } finally { if (existsSync(tmp)) rmSync(tmp); }
}

function currentFile(root, rel) {
  const full = checkedTarget(root, rel);
  try {
    const st = lstatSync(full);
    if (!st.isFile()) throw Error('Ziel ist keine reguläre Datei.');
    if (st.size > MAX_BYTES) throw Error('Datei überschreitet 64 MiB.');
    return { bytes: readFileSync(full), mode: process.platform !== 'win32' && (st.mode & 0o111) ? '100755' : '100644' };
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
const signature = f => f === null ? null : `${f.mode}:${hash(f.bytes)}`;
const equal = (a, b) => a === null || b === null ? a === b : a.bytes.equals(b.bytes) && (process.platform === 'win32' || a.mode === b.mode);

export class ManagedWorktrees {
  constructor({ storage = path.join(anvilHome(), 'worktrees'), run = runWorktreeProcess } = {}) {
    this.storage = path.resolve(storage); this.file = path.join(this.storage, 'registry.json'); this.run = run; this.queue = Promise.resolve();
  }
  records() {
    try {
      if (lstatSync(this.file).isSymbolicLink() || statSync(this.file).size > 2 * 1024 * 1024) throw Error('Ungültige Arbeitsstand-Registrierung.');
      const raw = JSON.parse(readFileSync(this.file, 'utf8'));
      if (raw.schema !== 1 || !Array.isArray(raw.worktrees) || raw.worktrees.length > 256) throw Error('Arbeitsstand-Registrierung ungültig.');
      for (const w of raw.worktrees) if (!validId(w.id) || !path.isAbsolute(w.source) || !path.isAbsolute(w.path) || !samePath(w.path, path.join(this.storage, 'checkouts', w.id)) || !/^[a-f0-9]{40,64}$/.test(w.baseRevision) || w.branch !== `anvil/task-${w.id}`) throw Error('Arbeitsstand-Registrierung ungültig.');
      return raw.worktrees;
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  save(records) { writeJson(this.file, { schema: 1, worktrees: records }); }
  async serial(fn) {
    const previous = this.queue; let release; this.queue = new Promise(r => { release = r; });
    await previous;
    let locked = false; const lock = path.join(this.storage, 'registry.lock'), nonce = randomUUID();
    try {
      mkdirSync(this.storage, { recursive: true });
      if (!samePath(realpathSync(this.storage), this.storage)) throw Error('Arbeitsstand-Speicher enthält eine Verknüpfung.');
      const acquire = () => {
        const fd = openSync(lock, 'wx', 0o600);
        try { writeFileSync(fd, JSON.stringify({ pid: process.pid, nonce })); fsyncSync(fd); } finally { closeSync(fd); }
        locked = true;
      };
      try { acquire(); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const before = readFileSync(lock, 'utf8'); let stale = false;
        try { const { pid } = JSON.parse(before); if (Number.isSafeInteger(pid) && pid > 0) { try { process.kill(pid, 0); } catch (e) { stale = e.code === 'ESRCH'; } } } catch { /* Unknown locks remain intact. */ }
        if (!stale || readFileSync(lock, 'utf8') !== before) throw Error('Eine andere Arbeitsstand-Aktion läuft noch. Nach deren Abschluss erneut versuchen.');
        rmSync(lock); acquire();
      }
      return await fn();
    } finally {
      if (locked) { try { if (JSON.parse(readFileSync(lock, 'utf8')).nonce === nonce) rmSync(lock); } catch { /* Never remove a foreign lock. */ } }
      release();
    }
  }
  async git(cwd, args, signal, input) {
    aborted(signal);
    const bin = gitBin(); if (!bin) throw Error('Git wurde nicht gefunden.');
    const config = ['-c', `core.hooksPath=${path.join(this.storage, 'disabled-hooks')}`, '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'core.quotePath=false'];
    // Repo-defined clean/smudge/process commands must not run on status/removal either.
    const filters = await this.run(bin, [...config, 'config', '--name-only', '--get-regexp', '^filter\\.'], { cwd, signal, maxBytes: 128 * 1024 });
    if (!filters.ok && filters.code !== 1) throw Error('Git-Filterkonfiguration konnte nicht sicher gelesen werden.');
    for (const name of new Set(filters.stdout.toString('utf8').split('\n').map(line => /^filter\.(.+)\.(?:clean|smudge|process|required)$/.exec(line.trim())?.[1]).filter(Boolean))) {
      for (const action of ['clean', 'smudge', 'process']) config.push('-c', `filter.${name}.${action}=`);
      config.push('-c', `filter.${name}.required=false`);
    }
    const result = await this.run(bin, [...config, ...args], { cwd, signal, input });
    if (!result.ok) throw Error((result.stderr || result.stdout.toString('utf8') || 'Git-Aktion fehlgeschlagen.').slice(0, 4000));
    return result.stdout;
  }
  async source(cwd, signal) {
    const requested = realpathSync(resolveCwd(cwd));
    const own = this.records().find(w => samePath(w.path, requested));
    const root = own?.source || requested;
    if (!samePath(root, realpathSync(root))) throw Error('Projektordner wurde verschoben.');
    const top = (await this.git(root, ['rev-parse', '--show-toplevel'], signal)).toString('utf8').trim();
    if (!samePath(top, root)) throw Error('Den Git-Projektstamm öffnen, bevor ein Arbeitsstand erstellt wird.');
    const common = path.resolve(root, (await this.git(root, ['rev-parse', '--git-common-dir'], signal)).toString('utf8').trim());
    return { root, common: realpathSync(common), sourceIdentity: identity(root) };
  }
  async validate(w, signal) {
    if (!existsSync(w.path) || !existsSync(w.source)) throw Error('Registrierter Arbeitsstand oder Projektordner fehlt oder wurde verschoben.');
    if (lstatSync(w.path).isSymbolicLink() || !samePath(realpathSync(w.path), w.path) || identity(w.path) !== w.identity || identity(w.source) !== w.sourceIdentity) throw Error('Registrierter Arbeitsstand wurde verschoben oder verändert.');
    const source = await this.source(w.source, signal);
    if (!samePath(source.common, w.common)) throw Error('Git-Projektzuordnung wurde verändert.');
    const top = (await this.git(w.path, ['rev-parse', '--show-toplevel'], signal)).toString('utf8').trim();
    const common = path.resolve(w.path, (await this.git(w.path, ['rev-parse', '--git-common-dir'], signal)).toString('utf8').trim());
    const gitFile = path.join(w.path, '.git');
    if (!samePath(top, w.path) || !samePath(realpathSync(common), w.common) || lstatSync(gitFile).isSymbolicLink() || readFileSync(gitFile, 'utf8') !== w.gitFile) throw Error('Arbeitsstand gehört nicht mehr zur registrierten Git-Zuordnung.');
    const branch = (await this.git(w.path, ['symbolic-ref', '--short', 'HEAD'], signal)).toString('utf8').trim();
    if (branch !== w.branch) throw Error('Der Branch des Arbeitsstands wurde verändert.');
    const listed = (await this.git(w.source, ['worktree', 'list', '--porcelain', '-z'], signal)).toString('utf8').split('\0');
    if (!listed.some(item => item.startsWith('worktree ') && samePath(item.slice(9), w.path))) throw Error('Arbeitsstand ist nicht mehr in Git registriert.');
  }
  async trees(root, revision, signal) {
    const raw = await this.git(root, ['ls-tree', '-r', '-z', '--full-tree', revision], signal);
    const entries = raw.toString('utf8').split('\0').filter(Boolean).map(line => {
      const at = line.indexOf('\t'), [mode, type, oid] = line.slice(0, at).split(' '), rel = line.slice(at + 1);
      if (!safeWorktreePath(rel) || !['100644', '100755'].includes(mode) || type !== 'blob') throw Error(`Verknüpfungen, Submodule oder unsichere Pfade sind in Arbeitsständen nicht unterstützt: ${rel}`);
      return { path: rel, mode, oid };
    });
    if (entries.length > MAX_FILES) throw Error('Arbeitsstand auf höchstens 4000 Dateien begrenzen.');
    return entries;
  }
  async blobs(root, entries, signal) {
    if (!entries.length) return new Map();
    const result = await this.git(root, ['cat-file', '--batch'], signal, entries.map(e => e.oid).join('\n') + '\n');
    let offset = 0, total = 0; const files = new Map();
    for (const e of entries) {
      const end = result.indexOf(10, offset), header = result.subarray(offset, end).toString('ascii');
      const [oid, type, sizeText] = header.split(' '), size = Number(sizeText);
      if (end < 0 || oid !== e.oid || type !== 'blob' || !Number.isSafeInteger(size) || size < 0 || total + size > MAX_BYTES || end + 1 + size >= result.length) throw Error('Git-Dateiinhalt unvollständig oder zu groß.');
      const bytes = result.subarray(end + 1, end + 1 + size); files.set(e.path, { bytes, mode: e.mode });
      total += size; offset = end + size + 2;
    }
    return files;
  }
  async create({ cwd, name = 'Aufgabe', signal } = {}) {
    return this.serial(async () => {
      aborted(signal);
      if (typeof name !== 'string' || !name.trim() || name.length > 80 || /[\\/:]|\.\./.test(name) || hasAsciiControl(name)) throw Error('Name des Arbeitsstands ungültig.');
      const records = this.records(); if (records.length >= 64) throw Error('Höchstens 64 verwaltete Arbeitsstände.');
      const { root, common, sourceIdentity } = await this.source(cwd, signal);
      const baseRevision = (await this.git(root, ['rev-parse', '--verify', 'HEAD^{commit}'], signal)).toString('ascii').trim();
      const branchRaw = (await this.git(root, ['rev-parse', '--abbrev-ref', 'HEAD'], signal)).toString('utf8').trim();
      const entries = await this.trees(root, baseRevision, signal), contents = await this.blobs(root, entries, signal);
      const dirty = (await this.git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], signal)).length > 0;
      const id = randomUUID(), branch = `anvil/task-${id}`, dest = path.join(this.storage, 'checkouts', id);
      mkdirSync(path.dirname(dest), { recursive: true }); mkdirSync(path.join(this.storage, 'disabled-hooks'), { recursive: true });
      if (!samePath(realpathSync(path.dirname(dest)), path.dirname(dest))) throw Error('Arbeitsstand-Speicher enthält eine Verknüpfung.');
      const w = { id, name: name.trim(), path: dest, source: root, common, sourceIdentity, baseRevision, baseBranch: branchRaw, branch, createdAt: Date.now(), sourceDirty: dirty, state: 'creating' };
      // Persist intent before invoking Git. Incomplete creation is retained for inspection.
      records.push(w); this.save(records);
      try {
        await this.git(root, ['worktree', 'add', '--no-checkout', '-b', branch, dest, baseRevision], signal);
        w.identity = identity(dest); w.gitFile = readFileSync(path.join(dest, '.git'), 'utf8'); this.save(records);
        await this.git(dest, ['read-tree', baseRevision], signal);
        aborted(signal);
        for (const [rel, file] of contents) {
          const full = checkedTarget(dest, rel); mkdirSync(path.dirname(full), { recursive: true });
          writeFileSync(full, file.bytes, { flag: 'wx', mode: file.mode === '100755' ? 0o755 : 0o644 });
        }
        w.state = 'ready'; this.save(records);
        return { ok: true, worktree: { ...w }, sourceDirty: dirty };
      } catch (error) { w.state = 'incomplete'; w.error = String(error.message || error); this.save(records); throw error; }
    });
  }
  async list({ cwd, signal } = {}) {
    const { root } = await this.source(cwd, signal), rows = [];
    for (const w of this.records().filter(w => samePath(w.source, root))) {
      try {
        await this.validate(w, signal);
        const dirty = (await this.git(w.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching'], signal)).length > 0;
        const head = (await this.git(w.path, ['rev-parse', 'HEAD'], signal)).toString('ascii').trim();
        rows.push({ ...w, dirty, committed: head !== w.baseRevision });
      } catch (error) { aborted(signal); rows.push({ ...w, unavailable: true, error: String(error.message || error) }); }
    }
    return { ok: true, cwd: root, worktrees: rows };
  }
  async record(cwd, id, signal) {
    if (!validId(id)) throw Error('Arbeitsstand-Kennung ungültig.');
    const { root } = await this.source(cwd, signal), w = this.records().find(w => w.id === id && samePath(w.source, root));
    if (!w) throw Error('Arbeitsstand ist für dieses Projekt nicht registriert.');
    await this.validate(w, signal);
    if (w.state !== 'ready') throw Error('Arbeitsstand wurde unvollständig erstellt; Dateien und Git-Zuordnung zuerst prüfen.');
    return w;
  }
  async comparison({ cwd, id, signal }) {
    const w = await this.record(cwd, id, signal);
    const baseEntries = await this.trees(w.path, w.baseRevision, signal), base = await this.blobs(w.path, baseEntries, signal);
    const diff = (await this.git(w.path, ['diff', '--no-ext-diff', '--no-textconv', '--raw', '--no-abbrev', '-z', '--no-renames', w.baseRevision, '--'], signal)).toString('utf8').split('\0').filter(Boolean);
    const tracked = [], modeConflicts = [];
    for (let n = 0; n < diff.length; n += 2) {
      const [beforeMode, afterMode, , , status] = diff[n].replace(/^:/, '').split(' '), rel = diff[n + 1];
      if (!rel || !safeWorktreePath(rel)) throw Error('Ungültiger Git-Dateivergleich.');
      tracked.push(rel);
      if (status === 'U') modeConflicts.push({ path: rel, reason: 'Unaufgelöster Indexkonflikt im Aufgabenstand.' });
      else if (!['000000', '100644', '100755'].includes(afterMode)) modeConflicts.push({ path: rel, reason: 'Verknüpfung oder Submodul im Aufgabenstand wird nicht rückgeführt.' });
      else if (process.platform === 'win32' && afterMode === '100755' && beforeMode !== afterMode) modeConflicts.push({ path: rel, reason: 'Ausführbare Dateimodi können unter Windows ohne Indexänderung nicht übertragen werden. Branch bleibt erhalten.' });
      else if (process.platform === 'win32' && beforeMode === '100755' && afterMode === '100644') modeConflicts.push({ path: rel, reason: 'Dateimodusänderungen können unter Windows ohne Indexänderung nicht übertragen werden. Branch bleibt erhalten.' });
    }
    const untracked = (await this.git(w.path, ['ls-files', '--others', '--exclude-standard', '-z'], signal)).toString('utf8').split('\0').filter(Boolean);
    const paths = [...new Set([...tracked, ...untracked])].sort();
    if (paths.length > MAX_FILES) throw Error('Vergleich auf höchstens 4000 Dateien begrenzen.');
    const changes = [], conflicts = [...modeConflicts], states = []; let total = 0, previewBytes = 0;
    for (const rel of paths) {
      aborted(signal);
      const before = base.get(rel) || null; let after, current;
      try { after = currentFile(w.path, rel); } catch (error) { conflicts.push({ path: rel, reason: `Aufgabenstand: ${error.message}` }); continue; }
      if (equal(before, after)) continue;
      try { current = currentFile(w.source, rel); } catch (error) { conflicts.push({ path: rel, reason: `Hauptprojekt: ${error.message}` }); continue; }
      total += (after?.bytes.length || 0) + (before?.bytes.length || 0) + (current?.bytes.length || 0);
      if (total > MAX_BYTES) throw Error('Rückführung auf höchstens 64 MiB begrenzen.');
      const conflict = !equal(current, before) && !equal(current, after);
      if (conflict) conflicts.push({ path: rel, reason: 'Datei im Hauptprojekt seit der Ausgangsrevision verändert.' });
      const preview = {};
      for (const [label, file] of [['beforeText', before], ['afterText', after], ...(conflict ? [['currentText', current]] : [])]) {
        if (!file) { preview[label] = ''; continue; }
        try {
          if (file.bytes.includes(0)) throw Error('binary');
          const text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes);
          if (previewBytes < 150000) { preview[label] = text.slice(0, 12000); previewBytes += preview[label].length; if (text.length > 12000) preview.previewTruncated = true; }
          else preview.previewTruncated = true;
        } catch { preview.binary = true; }
      }
      changes.push({ path: rel, kind: before === null ? 'A' : after === null ? 'D' : 'M', bytes: after?.bytes.length || 0, conflict, alreadyApplied: equal(current, after), ...preview });
      states.push({ path: rel, before, after, current });
    }
    const head = (await this.git(w.path, ['rev-parse', 'HEAD'], signal)).toString('ascii').trim();
    const revision = hash(JSON.stringify([w.id, w.baseRevision, head, states.map(s => [s.path, signature(s.before), signature(s.after), signature(s.current)]), conflicts]));
    return { w, states, public: { ok: true, worktree: w, baseRevision: w.baseRevision, revision, changes, conflicts } };
  }
  async compare(body = {}) { return this.serial(async () => (await this.comparison(body)).public); }
  async integrate({ cwd, id, expectedRevision, signal } = {}) {
    return this.serial(async () => {
      const { w, states, public: result } = await this.comparison({ cwd, id, signal });
      if (expectedRevision && expectedRevision !== result.revision) return { ...result, ok: false, error: 'Dateistand seit dem Vergleich geändert. Änderungen erneut ansehen.' };
      if (result.conflicts.length) return { ...result, ok: false, error: 'Rückführung hat Konflikte. Beide Arbeitsstände bleiben unverändert.' };
      const planned = states.filter(s => !equal(s.current, s.after));
      aborted(signal);
      // Every before-image is durable before the first file mutation; no target index is touched.
      const receipt = path.join(this.storage, 'returns', `${id}-${randomUUID()}.json`);
      const journal = { schema: 1, id, project: w.source, revision: result.revision, status: 'prepared', at: Date.now(), changes: planned.map(s => ({ path: s.path, before: s.current?.bytes.toString('base64') ?? null, after: s.after?.bytes.toString('base64') ?? null, beforeMode: s.current?.mode, afterMode: s.after?.mode })) };
      writeJson(receipt, journal);
      const applied = [];
      try {
        // Recheck the entire plan synchronously. No await occurs between checks and writes.
        for (const s of states) if (!equal(currentFile(w.source, s.path), s.current) || !equal(currentFile(w.path, s.path), s.after)) throw Error(`Datei während der Rückführung verändert: ${s.path}`);
        aborted(signal);
        for (const s of planned) {
          const full = checkedTarget(w.source, s.path);
          if (s.after === null) rmSync(full);
          else {
            mkdirSync(path.dirname(full), { recursive: true }); checkedTarget(w.source, s.path);
            const tmp = `${full}.anvil-return-${randomUUID()}.tmp`;
            try {
              writeFileSync(tmp, s.after.bytes, { flag: 'wx', mode: s.after.mode === '100755' ? 0o755 : 0o644 });
              if (!equal(currentFile(w.source, s.path), s.current)) throw Error(`Zieldatei inzwischen geändert: ${s.path}`);
              renameSync(tmp, full); if (process.platform !== 'win32') chmodSync(full, s.after.mode === '100755' ? 0o755 : 0o644);
            } finally { if (existsSync(tmp)) rmSync(tmp); }
          }
          applied.push(s);
        }
        journal.status = 'applied'; writeJson(receipt, journal);
      } catch (error) {
        const recoveryConflicts = [];
        for (const s of applied.reverse()) {
          try {
            if (!equal(currentFile(w.source, s.path), s.after)) { recoveryConflicts.push(s.path); continue; }
            const full = checkedTarget(w.source, s.path);
            if (s.current === null) rmSync(full);
            else { writeFileSync(full, s.current.bytes); if (process.platform !== 'win32') chmodSync(full, s.current.mode === '100755' ? 0o755 : 0o644); }
          } catch { recoveryConflicts.push(s.path); }
        }
        journal.status = recoveryConflicts.length ? 'recovery-needed' : 'rolled-back'; journal.recoveryConflicts = recoveryConflicts; writeJson(receipt, journal);
        return { ...result, ok: false, receipt, recoveryConflicts, error: `${error.message}${recoveryConflicts.length ? ' Fremde Änderungen bleiben erhalten; Rückführungsprotokoll prüfen.' : ' Bereits übernommene Dateien wurden auf den geprüften Stand zurückgesetzt.'}` };
      }
      return { ...result, ok: true, applied: planned.map(s => s.path), receipt };
    });
  }
  async remove({ cwd, id, signal } = {}) {
    return this.serial(async () => {
      const w = await this.record(cwd, id, signal);
      const status = await this.git(w.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching'], signal);
      const head = (await this.git(w.path, ['rev-parse', 'HEAD'], signal)).toString('ascii').trim();
      if (status.length || head !== w.baseRevision) throw Error('Arbeitsstand enthält Änderungen, eigene Commits oder ignorierte Dateien und bleibt erhalten.');
      await this.git(w.source, ['worktree', 'remove', w.path], signal);
      this.save(this.records().filter(record => record.id !== id));
      return { ok: true, id, branchRetained: w.branch };
    });
  }
  async dispatch(action, body = {}) {
    if (action === 'list') return this.list(body);
    if (action === 'create') return this.create(body);
    if (action === 'compare') return this.compare(body);
    if (action === 'integrate') return this.integrate(body);
    if (action === 'remove') return this.remove(body);
    if (action === 'open') { const w = await this.record(body.cwd, body.id, body.signal); return { ok: true, worktree: w, cwd: w.path }; }
    throw Error('Unbekannte Arbeitsstand-Aktion.');
  }
}

let current;
export function worktreeManager() {
  const storage = path.join(anvilHome(), 'worktrees');
  if (!current || !samePath(current.storage, storage)) current = new ManagedWorktrees({ storage });
  return current;
}
