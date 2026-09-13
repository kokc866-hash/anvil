import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export const PROJECT_CHECKPOINT_LIMITS = Object.freeze({ files: 100_000, fileBytes: 8 * 1024 ** 3, totalBytes: 64 * 1024 ** 3 });
export const PROJECT_CHECKPOINT_READ_LIMITS = Object.freeze({ files: 100_000, fileBytes: 32 * 1024 ** 2, totalBytes: 256 * 1024 ** 2 });
// Directory policy mirrors ws-skip.ts, with generated engine caches added. Unlike
// the editor index, checkpoints include binaries, lockfiles and unopened files.
const SKIP_DIRS = new Set("node_modules .git dist build .next .vercel __pycache__ .venv venv target vendor coverage .turbo .cache out bin obj .pnpm-store pods .idea .gradle .output .nuxt .svelte-kit .godot library temp binaries intermediate saved".split(" "));
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const locks = new Map();
const fold = (p) => process.platform === "win32" ? p.toLowerCase() : p;
const within = (root, p) => fold(p) === fold(root) || fold(p).startsWith(fold(root + path.sep));
const same = (a, b) => a?.type === b?.type && (a?.type !== "file" || (a.hash === b.hash && a.bytes === b.bytes && a.mode === b.mode));
const exists = async (p) => { try { return await fs.lstat(p); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };
function validName(name) {
  return typeof name === "string" && name.length > 0 && !/[\\:<>"|?*\x00-\x1f]/.test(name) && name.split("/").every((p) => p && p !== "." && p !== ".." && !/[. ]$/.test(p) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));
}
// Same path-based secret exclusions as ref.ts, also applied to directory names.
function secret(name) {
  const base = name.split("/").at(-1);
  if (/\.env\.(example|sample|template)$/i.test(base)) return false;
  if (/(^|\/)\.env($|\.(?!example|sample|template))/i.test(name) || /(^|\/)(\.git-credentials|id_rsa|credentials)$/i.test(name) || /\.(pem|p12|pfx)$/i.test(base)) return true;
  if (/\.(md|ts|tsx|js|jsx|mjs|cjs|py|go|rs)$/i.test(base)) return false;
  return /^(secrets?|password|token)(\.|$)/i.test(base) || /api[_-]?key/i.test(base) || /(^|\/)(secrets?|vault)(\.|\/|$)/i.test(name);
}
async function serial(root, work) {
  const key = fold(path.resolve(root));
  const previous = locks.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  locks.set(key, next);
  try { return await next; } finally { if (locks.get(key) === next) locks.delete(key); }
}
// Validate every existing ancestor, including junctions on Windows. No recursive
// delete is used anywhere in this module.
async function safeAbsolute(p, create = false) {
  const absolute = path.resolve(p);
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    let stat = await exists(cursor);
    if (!stat && create) { try { await fs.mkdir(cursor); } catch (e) { if (e.code !== "EEXIST") throw e; } stat = await fs.lstat(cursor); }
    if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Kein sicherer Projekt-/Sicherungsordner: ${cursor}`);
  }
  if (fold(await fs.realpath(absolute)) !== fold(absolute)) throw new Error(`Verknüpfter Ordner ist nicht erlaubt: ${absolute}`);
  return absolute;
}
async function context(args, create = false) {
  if (!args || typeof args.root !== "string" || typeof args.storageRoot !== "string" || !UUID.test(args.id || "")) throw new Error("Ungültige Projektsicherung.");
  const root = await safeAbsolute(args.root);
  const storage = path.resolve(args.storageRoot);
  if (within(storage, root)) throw new Error("Sicherungsordner darf nicht das Projekt oder dessen übergeordneter Ordner sein.");
  await safeAbsolute(storage, create);
  const excludedRoots = [storage, ...(args.excludedRoots || [])].map((p) => path.resolve(p)).filter((p) => within(root, p));
  if (excludedRoots.some((p) => fold(p) === fold(root))) throw new Error("Das gesamte Projekt kann nicht von der Sicherung ausgeschlossen werden.");
  const dir = path.join(storage, "checkpoints", args.id.toLowerCase());
  if (create) { await safeAbsolute(dir, true); await safeAbsolute(path.join(storage, "blobs"), true); }
  else await safeAbsolute(dir);
  return { root, storage, dir, id: args.id.toLowerCase(), excludedRoots, onProgress: args.onProgress };
}
async function target(c, name, allowMissing = true) {
  if (!validName(name)) throw new Error(`Ungültiger Sicherungspfad: ${name}`);
  await safeAbsolute(c.root);
  let cursor = c.root;
  const parts = name.split("/");
  for (let i = 0; i < parts.length; i++) {
    cursor = path.join(cursor, parts[i]);
    const stat = await exists(cursor);
    if (!stat) { if (allowMissing) return path.join(c.root, ...parts); throw new Error(`Datei fehlt: ${name}`); }
    if (stat.isSymbolicLink() || (i < parts.length - 1 && !stat.isDirectory())) throw new Error(`Verknüpfung oder blockierter Pfad: ${name}`);
  }
  return cursor;
}
const fingerprint = (s) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}:${s.mode}`;
async function readFile(p, saveTo, maxBytes = PROJECT_CHECKPOINT_LIMITS.fileBytes) {
  const before = await fs.lstat(p);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error(`Keine reguläre Datei: ${p}`);
  if (before.size > maxBytes) throw new Error(`Datei überschreitet das Sicherungslimit (${maxBytes} Bytes): ${p}`);
  const source = await fs.open(p, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  let dest;
  try {
    if (fingerprint(await source.stat()) !== fingerprint(before)) throw new Error(`Datei wurde während der Sicherung verändert: ${p}`);
    if (saveTo) dest = await fs.open(saveTo, "wx", 0o600);
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytes = 0;
    for (;;) {
      const result = await source.read(buffer, 0, buffer.length, null);
      if (!result.bytesRead) break;
      bytes += result.bytesRead;
      if (bytes > maxBytes) throw new Error(`Datei überschreitet das Sicherungslimit: ${p}`);
      const chunk = buffer.subarray(0, result.bytesRead);
      hash.update(chunk);
      if (dest) await dest.writeFile(chunk);
    }
    if (fingerprint(await source.stat()) !== fingerprint(before) || fingerprint(await fs.lstat(p)) !== fingerprint(before) || bytes !== before.size) throw new Error(`Datei wurde während der Sicherung verändert: ${p}`);
    if (dest) await dest.sync();
    return { entry: { type: "file", hash: hash.digest("hex"), bytes, mode: before.mode & 0o777 }, fingerprint: fingerprint(before) };
  } finally { await source.close(); await dest?.close(); }
}
async function atomicJson(p, value) {
  const temp = `${p}.${randomUUID()}.tmp`;
  const handle = await fs.open(temp, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
  try { await fs.rename(temp, p); } catch (e) { await fs.unlink(temp).catch(() => {}); throw e; }
}
function skipped(c, name, directory) {
  return c.excludedRoots.some((p) => within(p, path.join(c.root, ...name.split("/")))) || secret(name) || name.split("/").at(-1).toLowerCase() === ".git" || (directory && SKIP_DIRS.has(name.split("/").at(-1).toLowerCase())) || /(^|\/)\.anvil\/(work|out)(\/|$)/i.test(name);
}
async function scan(c, save = false, ignored = null) {
  const entries = Object.create(null), stamps = new Map(), excluded = [], names = new Set();
  let bytes = 0, count = 0;
  async function walk(rel) {
    const dir = rel ? await target(c, rel, false) : c.root;
    const children = await fs.readdir(dir);
    for (const base of children.sort()) {
      const name = rel ? `${rel}/${base}` : base;
      if (name === ignored) continue;
      if (!validName(name)) throw new Error(`Nicht portabler Dateiname im Projekt: ${name}`);
      const key = name.toLowerCase();
      if (names.has(key)) throw new Error(`Groß-/Kleinschreibung kollidiert im Projekt: ${name}`);
      names.add(key);
      const p = await target(c, name, false);
      const stat = await fs.lstat(p);
      if (skipped(c, name, stat.isDirectory())) { excluded.push(name); continue; }
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error(`Verknüpfung oder spezielle Datei wird nicht gesichert: ${name}`);
      if (++count > PROJECT_CHECKPOINT_LIMITS.files) throw new Error(`Projekt überschreitet ${PROJECT_CHECKPOINT_LIMITS.files} Sicherungseinträge.`);
      if (stat.isDirectory()) { entries[name] = { type: "dir" }; await walk(name); }
      else {
        if (bytes + stat.size > PROJECT_CHECKPOINT_LIMITS.totalBytes) throw new Error("Projekt überschreitet das Sicherungslimit von 64 GiB.");
        const temp = save ? path.join(c.storage, "blobs", `${randomUUID()}.tmp`) : null;
        try {
          const read = await readFile(p);
          bytes += read.entry.bytes;
          if (bytes > PROJECT_CHECKPOINT_LIMITS.totalBytes) throw new Error("Projekt überschreitet das Sicherungslimit von 64 GiB.");
          entries[name] = read.entry;
          stamps.set(name, read.fingerprint);
          if (temp) {
            const blob = path.join(c.storage, "blobs", read.entry.hash);
            const present = await exists(blob);
            if (present) {
              const verified = await readFile(blob);
              if (verified.entry.hash !== read.entry.hash) throw new Error("Beschädigter Sicherungsinhalt.");
            } else {
              const copied = await readFile(p, temp);
              if (copied.entry.hash !== read.entry.hash || copied.fingerprint !== read.fingerprint) throw new Error(`Datei wurde während der Sicherung verändert: ${name}`);
              await fs.rename(temp, blob);
            }
          }
          if (save) await c.onProgress?.({ path: name, files: count, bytes });
        } finally { if (temp) await fs.unlink(temp).catch((e) => { if (e.code !== "ENOENT") throw e; }); }
      }
    }
  }
  await walk("");
  // A second directory inventory and final metadata pass catch renames/additions
  // and edits that occur after an earlier file was copied.
  async function verify(rel) {
    const dir = rel ? await target(c, rel, false) : c.root;
    for (const base of (await fs.readdir(dir)).sort()) {
      const name = rel ? `${rel}/${base}` : base;
      if (name === ignored) continue;
      const p = await target(c, name, false), stat = await fs.lstat(p);
      if (skipped(c, name, stat.isDirectory())) continue;
      if (!entries[name] || stat.isSymbolicLink()) throw new Error(`Projekt wurde während der Sicherung verändert: ${name}`);
      if (entries[name].type === "dir") { if (!stat.isDirectory()) throw new Error(`Projekt wurde verändert: ${name}`); await verify(name); }
      else if (fingerprint(stat) !== stamps.get(name)) throw new Error(`Datei wurde während der Sicherung verändert: ${name}`);
    }
  }
  await verify("");
  for (const [name, entry] of Object.entries(entries)) {
    const stat = await fs.lstat(await target(c, name, false));
    if (entry.type === "dir" ? !stat.isDirectory() : fingerprint(stat) !== stamps.get(name)) throw new Error(`Projekt wurde während der Sicherung verändert: ${name}`);
  }
  return { entries, excluded, bytes };
}
function validateManifest(c, m) {
  if (!m || m.version !== 1 || fold(m.root || "") !== fold(c.root) || m.id !== c.id || !["before", "after"].includes(m.phase) || !m.entries || typeof m.entries !== "object" || Array.isArray(m.entries) || !Array.isArray(m.excluded)) throw new Error("Ungültiges Sicherungsverzeichnis.");
  m.entries = Object.assign(Object.create(null), m.entries);
  const seen = new Set();
  if (Object.keys(m.entries).length > PROJECT_CHECKPOINT_LIMITS.files) throw new Error("Zu viele Einträge im Sicherungsverzeichnis.");
  for (const [name, entry] of Object.entries(m.entries)) {
    if (!validName(name) || seen.has(name.toLowerCase()) || !entry || !["dir", "file"].includes(entry.type) || skipped(c, name, entry.type === "dir")) throw new Error("Unsicherer Pfad im Sicherungsverzeichnis.");
    seen.add(name.toLowerCase());
    if (entry.type === "file" && (!HASH.test(entry.hash) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > PROJECT_CHECKPOINT_LIMITS.fileBytes || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777)) throw new Error("Ungültiger Dateiinhalt im Sicherungsverzeichnis.");
    const parent = name.slice(0, name.lastIndexOf("/"));
    if (name.includes("/") && m.entries[parent]?.type !== "dir") throw new Error("Fehlender Elternordner im Sicherungsverzeichnis.");
  }
  if (m.excluded.some((p) => !validName(p))) throw new Error("Ungültige Sicherungsausnahmen.");
  return m;
}
async function manifest(c, phase) {
  const p = path.join(c.dir, `${phase}.json`);
  const stat = await fs.lstat(p);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 100_000_000) throw new Error("Ungültiges Sicherungsverzeichnis.");
  const m = validateManifest(c, JSON.parse(await fs.readFile(p, "utf8")));
  if (m.phase !== phase) throw new Error("Vertauschte Sicherungsphase.");
  return m;
}
const summary = (m) => ({ id: m.id, phase: m.phase, files: Object.values(m.entries).filter((e) => e.type === "file").length, bytes: Object.values(m.entries).reduce((sum, e) => sum + (e.bytes || 0), 0), excluded: m.excluded });

export async function createProjectCheckpoint(args) {
  return serial(args.root, async () => {
    if (!["before", "after"].includes(args.phase)) throw new Error("Ungültige Sicherungsphase.");
    const c = await context(args, true);
    if (await exists(path.join(c.dir, `${args.phase}.json`))) return summary(await manifest(c, args.phase));
    if (args.phase === "after") await manifest(c, "before");
    const snapshot = await scan(c, true);
    const m = { version: 1, root: c.root, id: c.id, phase: args.phase, entries: snapshot.entries, excluded: snapshot.excluded };
    await atomicJson(path.join(c.dir, `${args.phase}.json`), m);
    return summary(m);
  });
}
async function journal(c) {
  const p = path.join(c.dir, "restore.json");
  if (!(await exists(p))) return null;
  const stat = await fs.lstat(p);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 100_000_000) throw new Error("Ungültiges Wiederherstellungsjournal.");
  const j = JSON.parse(await fs.readFile(p, "utf8"));
  if (j.version !== 1 || j.id !== c.id || !["restoring", "complete"].includes(j.state) || (j.pendingTemp && (!validName(j.pendingTemp) || !new RegExp(`^\\.anvil-restore-${c.id}-[a-f0-9-]{36}\\.tmp$`).test(j.pendingTemp.split("/").at(-1)))) || (j.transitions && (!Array.isArray(j.transitions) || j.transitions.some((p) => !validName(p))))) throw new Error("Ungültiges Wiederherstellungsjournal.");
  return j;
}
async function plan(c) {
  const before = await manifest(c, "before"), after = await manifest(c, "after"), j = await journal(c);
  const current = await scan(c, false, j?.pendingTemp);
  const changed = [...new Set([...Object.keys(before.entries), ...Object.keys(after.entries)])].filter((p) => !same(before.entries[p], after.entries[p])).sort();
  const conflicts = [], files = [], mkdir = [], rmdir = [];
  for (const name of changed) {
    const b = before.entries[name], a = after.entries[name], now = current.entries[name];
    // A file/directory replacement has a durable deletion intent before its
    // first unlink/rmdir. On retry its intermediate absence is expected.
    const intermediate = !now && b && a && b.type !== a.type && j?.state === "restoring" && j.transitions?.includes(name);
    if (!same(now, b) && !same(now, a) && !intermediate) { conflicts.push(name); continue; }
    if (same(now, b)) continue;
    if (b?.type === "file") files.push({ path: name, action: "restore", bytes: b.bytes });
    else if (now?.type === "file") files.push({ path: name, action: "delete", bytes: now.bytes });
    if (b?.type === "dir" && now?.type !== "dir") mkdir.push(name);
    if (now?.type === "dir" && b?.type !== "dir") rmdir.push(name);
  }
  // Removing a directory must never consume an unrelated later file or an
  // excluded secret/cache. rmdir remains non-recursive as a second guard.
  for (const dir of rmdir) {
    for (const name of [...Object.keys(current.entries), ...current.excluded]) {
      if (name.startsWith(`${dir}/`) && (!changed.includes(name) || before.entries[name])) conflicts.push(name);
    }
  }
  for (const name of [...mkdir, ...files.filter((f) => f.action === "restore").map((f) => f.path)]) {
    let parent = name;
    while (parent.includes("/")) {
      parent = parent.slice(0, parent.lastIndexOf("/"));
      if (current.entries[parent]?.type !== "dir" && !mkdir.includes(parent)) conflicts.push(parent);
    }
  }
  return { before, after, current, journal: j, result: { files, mkdir: mkdir.sort((a, b) => a.length - b.length), rmdir: rmdir.sort((a, b) => b.length - a.length), conflicts: [...new Set(conflicts)], excluded: [...new Set([...before.excluded, ...after.excluded, ...current.excluded])].sort() } };
}
export async function previewProjectCheckpoint(args) {
  return serial(args.root, async () => (await plan(await context(args))).result);
}

const IMAGE_MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon", bmp: "image/bmp", avif: "image/avif", tif: "image/tiff", tiff: "image/tiff" };
function encodedFile(name, bytes) {
  const image = IMAGE_MIME[path.extname(name).slice(1).toLowerCase()];
  if (!image && !bytes.includes(0)) {
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { /* Opaque binary bytes stay binary. */ }
  }
  return `data:${image || "application/octet-stream"};base64,${bytes.toString("base64")}`;
}
async function boundedBytes(p, expected, budget) {
  const stat = await fs.lstat(p);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Keine sichere reguläre Datei zum Laden.");
  if (stat.size > PROJECT_CHECKPOINT_READ_LIMITS.fileBytes || stat.size > budget) throw new Error("Dateien überschreiten das Ladelimit (32 MiB je Datei, 256 MiB insgesamt). Keine Rücknahme ausgeführt.");
  const handle = await fs.open(p, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    if (fingerprint(await handle.stat()) !== fingerprint(stat)) throw new Error("Datei während des Ladens verändert.");
    const bytes = Buffer.allocUnsafe(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, null);
      if (!read.bytesRead) throw new Error("Datei während des Ladens verkürzt.");
      offset += read.bytesRead;
    }
    if (fingerprint(await handle.stat()) !== fingerprint(stat) || fingerprint(await fs.lstat(p)) !== fingerprint(stat)) throw new Error("Datei während des Ladens verändert.");
    if (expected && (bytes.length !== expected.bytes || createHash("sha256").update(bytes).digest("hex") !== expected.hash)) throw new Error("Beschädigte Sicherung beim Laden.");
    return bytes;
  } finally { await handle.close(); }
}

/** Read every requested editor value without truncation or lossy binary decoding.
 * source: before lets the renderer stage its complete RAM update BEFORE restore,
 * so reload errors/limits cannot leave a successful disk restore with stale RAM.
 */
export async function readProjectCheckpointFiles(args) {
  return serial(args.root, async () => {
    const c = await context(args), before = await manifest(c, "before");
    if (!Array.isArray(args.paths) || args.paths.length > PROJECT_CHECKPOINT_READ_LIMITS.files || (args.source && !["current", "before"].includes(args.source))) throw new Error("Ungültige Dateiliste zum Laden.");
    const source = args.source || "current", files = Object.create(null), reads = [];
    let total = 0;
    // Validate all paths and byte sizes before allocating response content.
    for (const name of new Set(args.paths)) {
      if (!validName(name) || skipped(c, name, false) || name.split("/").slice(0, -1).some((p) => SKIP_DIRS.has(p.toLowerCase())) || before.excluded.some((p) => name === p || name.startsWith(`${p}/`))) throw new Error(`Ausgenommener oder ungültiger Ladepfad: ${name}`);
      const entry = source === "before" ? before.entries[name] : null;
      if (source === "before" && !entry) { files[name] = null; continue; }
      if (entry?.type === "dir") throw new Error(`Ordner kann nicht als Datei geladen werden: ${name}`);
      const p = source === "before" ? path.join(c.storage, "blobs", entry.hash) : await target(c, name);
      if (source === "before") await safeAbsolute(path.join(c.storage, "blobs"));
      const stat = await exists(p);
      if (!stat && source === "current") { files[name] = null; continue; }
      if (!stat || !stat.isFile() || stat.isSymbolicLink()) throw new Error(`Datei nicht sicher lesbar: ${name}`);
      total += stat.size;
      if (stat.size > PROJECT_CHECKPOINT_READ_LIMITS.fileBytes || total > PROJECT_CHECKPOINT_READ_LIMITS.totalBytes) throw new Error("Dateien überschreiten das Ladelimit (32 MiB je Datei, 256 MiB insgesamt). Keine Rücknahme ausgeführt.");
      reads.push({ name, p, entry });
    }
    total = 0;
    for (const { name, p, entry } of reads) {
      if (source === "current") await target(c, name, false);
      const bytes = await boundedBytes(p, entry, PROJECT_CHECKPOINT_READ_LIMITS.totalBytes - total);
      total += bytes.length;
      files[name] = encodedFile(name, bytes);
    }
    return files;
  });
}

export async function restoreProjectCheckpoint(args) {
  return serial(args.root, async () => {
    const c = await context(args), p = await plan(c);
    if (p.result.conflicts.length) return p.result;
    // Validate every required blob before the first mutation, including hashes.
    await safeAbsolute(path.join(c.storage, "blobs"));
    for (const item of p.result.files.filter((f) => f.action === "restore")) {
      const entry = p.before.entries[item.path];
      const read = await readFile(path.join(c.storage, "blobs", entry.hash));
      if (read.entry.hash !== entry.hash || read.entry.bytes !== entry.bytes) throw new Error(`Beschädigte Sicherung: ${item.path}`);
    }
    let state = { version: 1, id: c.id, state: "restoring", completed: p.journal?.completed || 0, pendingTemp: null, transitions: p.journal?.transitions || [] };
    const saveJournal = () => atomicJson(path.join(c.dir, "restore.json"), state);
    if (p.journal?.pendingTemp) {
      const temp = await target(c, p.journal.pendingTemp), stat = await exists(temp);
      if (stat) { if (!stat.isFile()) throw new Error("Blockierte Wiederherstellungsdatei."); await fs.unlink(temp); }
    }
    await saveJournal();
    const progress = async (name) => { state.completed++; await saveJournal(); await args.onProgress?.({ path: name, completed: state.completed }); };
    const transitionIntent = async (name) => {
      if (p.before.entries[name] && p.after.entries[name] && p.before.entries[name].type !== p.after.entries[name].type && !state.transitions.includes(name)) { state.transitions.push(name); await saveJournal(); }
    };
    const checkUnchanged = async (name) => {
      const destination = await target(c, name), stat = await exists(destination);
      const now = !stat ? undefined : stat.isDirectory() ? { type: "dir" } : (await readFile(destination)).entry;
      if (!same(now, p.current.entries[name])) throw new Error(`Projekt wurde während der Rücknahme verändert: ${name}`);
      return destination;
    };
    for (const item of p.result.files.filter((f) => f.action === "delete")) { await transitionIntent(item.path); await fs.unlink(await checkUnchanged(item.path)); await progress(item.path); }
    for (const name of p.result.rmdir) { await transitionIntent(name); await fs.rmdir(await checkUnchanged(name)); await progress(name); }
    for (const name of p.result.mkdir) {
      // A file-to-directory transition was deliberately removed above.
      const destination = await target(c, name);
      if (await exists(destination)) throw new Error(`Ziel wurde während der Rücknahme angelegt: ${name}`);
      await fs.mkdir(destination); await progress(name);
    }
    for (const item of p.result.files.filter((f) => f.action === "restore")) {
      const entry = p.before.entries[item.path];
      const destination = await target(c, item.path);
      if (p.current.entries[item.path]?.type !== "dir") await checkUnchanged(item.path);
      else if (await exists(destination)) throw new Error(`Ziel wurde während der Rücknahme angelegt: ${item.path}`);
      const parent = item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/")) + "/" : "";
      state.pendingTemp = `${parent}.anvil-restore-${c.id}-${randomUUID()}.tmp`;
      await saveJournal();
      const temp = await target(c, state.pendingTemp);
      const copied = await readFile(path.join(c.storage, "blobs", entry.hash), temp);
      if (copied.entry.hash !== entry.hash) throw new Error(`Beschädigte Sicherung: ${item.path}`);
      await fs.chmod(temp, entry.mode);
      // Recheck after staging, immediately before the atomic replacement.
      if (p.current.entries[item.path]?.type !== "dir") await checkUnchanged(item.path);
      else if (await exists(await target(c, item.path))) throw new Error(`Ziel wurde während der Rücknahme angelegt: ${item.path}`);
      await fs.rename(temp, destination);
      state.pendingTemp = null;
      await progress(item.path);
    }
    state.state = "complete";
    await saveJournal();
    return p.result;
  });
}
