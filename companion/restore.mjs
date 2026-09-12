import { existsSync, lstatSync, realpathSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, rmdirSync, readdirSync, renameSync, openSync, fsyncSync, closeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileBytes } from "../scripts/file-content.mjs";

const inside = (root, name) => { const rel = path.relative(root, name); return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };

/** All paths are relative, exact files; links and recursive deletes are deliberately excluded. */
function target(root, rel) {
  if (typeof rel !== "string" || !rel || /[:\\\x00-\x1f]/.test(rel) || rel.split("/").some((p) => !p || p === "." || p === "..")) throw new Error("Pfad ungültig.");
  const full = path.resolve(root, rel);
  if (!inside(root, full) || full === root) throw new Error("Pfad verlässt den Workspace.");
  let parent = full;
  while (!existsSync(parent)) parent = path.dirname(parent);
  if (!inside(root, realpathSync(parent))) throw new Error("Pfad verlässt den Workspace.");
  // Reject links even when they point inside: undo must never follow a different object.
  for (let part = full; part !== root; part = path.dirname(part)) {
    if (existsSync(part) && lstatSync(part).isSymbolicLink()) throw new Error("Verknüpfung kann nicht zurückgenommen werden.");
  }
  return full;
}
const bytes = (s) => s === null ? null : Buffer.from(fileBytes(s));
const same = (a, b) => a === null ? b === null : b !== null && a.equals(b);
const read = (full) => existsSync(full) ? readFileSync(full) : null;
function write(full, value) {
  if (value === null) { if (existsSync(full)) unlinkSync(full); }
  else {
    mkdirSync(path.dirname(full), { recursive: true });
    const temporary = path.join(path.dirname(full), `.anvil-restore-${randomUUID()}.tmp`);
    try {
      const fd = openSync(temporary, "wx");
      try { writeFileSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporary, full);
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
}

/** A durable intent is written before mutation. An interrupted operation is completed
 * idempotently on retry; each exact file is still checked, including after a crash. */
export function restoreRel(cwd, request, hooks = {}) {
  const root = realpathSync(cwd);
  if (!request || !Array.isArray(request.files) || !Array.isArray(request.mkdir) || !Array.isArray(request.rmdir) || request.files.length > 10000) throw new Error("Rücknahmeplan ungültig.");
  const seen = new Set();
  const files = request.files.map((f) => {
    if (!f || !(typeof f.expected === "string" || f.expected === null) || !(typeof f.after === "string" || f.after === null) || seen.has(f.path)) throw new Error("Rücknahmeplan ungültig.");
    seen.add(f.path);
    return { ...f, full: target(root, f.path), expectedBytes: bytes(f.expected), afterBytes: bytes(f.after) };
  });
  const make = request.mkdir.map((p) => ({ path: p, full: target(root, p) }));
  const remove = request.rmdir.map((p) => ({ path: p, full: target(root, p) })).sort((a, b) => b.path.length - a.path.length);
  // Preflight the complete set before the first mutation; an external conflict changes nothing.
  for (const f of files) {
    const actual = read(f.full);
    if (!same(actual, f.expectedBytes) && !same(actual, f.afterBytes)) throw new Error(`Datei extern geändert: ${f.path}. Rücknahme abgebrochen.`);
  }
  for (const d of make) if (existsSync(d.full) && !lstatSync(d.full).isDirectory()) throw new Error(`Ordner durch Datei belegt: ${d.path}`);
  for (const d of remove) if (existsSync(d.full) && !lstatSync(d.full).isDirectory()) throw new Error(`Ordner extern geändert: ${d.path}`);
  const originals = files.map((f) => ({ full: f.full, value: read(f.full), next: f.afterBytes }));
  const created = [];
  const removed = [];
  const makeParents = (full) => {
    const missing = [];
    for (let d = full; !existsSync(d); d = path.dirname(d)) missing.push(d);
    for (const d of missing.reverse()) { mkdirSync(d); created.push(d); }
  };
  try {
    for (const d of make) makeParents(d.full);
    for (const [i, f] of files.entries()) {
      // Recheck immediately before each mutation, including a file replaced during preflight.
      target(root, f.path);
      const actual = read(f.full);
      if (!same(actual, f.expectedBytes) && !same(actual, f.afterBytes)) throw new Error(`Datei extern geändert: ${f.path}. Rücknahme abgebrochen.`);
      hooks.beforeWrite?.(i, f.path);
      if (f.afterBytes !== null) makeParents(path.dirname(f.full));
      write(f.full, f.afterBytes);
    }
    for (const d of remove) if (existsSync(d.full) && readdirSync(d.full).length === 0) { rmdirSync(d.full); removed.push(d.full); }
    return { ok: true, removedDirs: remove.filter((d) => !existsSync(d.full)).map((d) => d.path) };
  } catch (error) {
    const failures = [];
    for (const d of removed.reverse()) { try { mkdirSync(d, { recursive: true }); } catch (e) { failures.push(e); } }
    for (const old of originals.reverse()) {
      try {
        const actual = read(old.full);
        if (same(actual, old.value)) continue;
        if (!same(actual, old.next)) throw new Error("Datei während Rücknahme extern geändert.");
        write(old.full, old.value);
      } catch (e) { failures.push(e); }
    }
    for (const d of created.reverse()) { try { if (existsSync(d) && !readdirSync(d).length) rmdirSync(d); } catch (e) { failures.push(e); } }
    if (failures.length) throw new Error(`${error.message} Rücknahme unvollständig; erneut versuchen. Gesicherter Plan bleibt erhalten.`);
    throw error;
  }
}
