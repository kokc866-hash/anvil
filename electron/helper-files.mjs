import { mkdir, readFile, writeFile, stat, lstat, readdir, link, copyFile, rename, rm, open } from "node:fs/promises";
import { join, dirname, relative, isAbsolute } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { downloadFile, helperModelId, hfAllowed, MAX_JOB_FILES } from "./hf-get.mjs";
import { readFileSync, createReadStream } from "node:fs";

export function helperFilePath(root, rel) {
  if (typeof rel !== "string" || !rel || /[\\\x00:]/.test(rel) || rel.split("/").some((x) => !x || x === "." || x === "..")) throw new Error("Modell-Dateipfad ungültig");
  const dest = join(root, rel);
  if (isAbsolute(rel) || relative(root, dest).startsWith("..")) throw new Error("Modell-Dateipfad ungültig");
  return dest;
}
export function jsonFileOk(path) {
  try { const j = JSON.parse(readFileSync(path, "utf8")); return j !== null && typeof j === "object"; } catch { return false; }
}

/** A published bundle has all declared shards, tokenizers and its own WASM.
 * Read only bounded manifests and file metadata, never recursively walk gigabytes. */
export async function helperModelInfo(dir) {
  try {
    const [config, receipt] = await Promise.all([
      readFile(join(dir, "mlc-chat-config.json"), "utf8").then(JSON.parse),
      readFile(join(dir, "anvil-model.json"), "utf8").then(JSON.parse),
    ]);
    const manifest = await readFile(join(dir, "tensor-cache.json"), "utf8").then(JSON.parse);
    const files = Array.isArray(receipt.files) ? receipt.files : [];
    if (!files.length || files.length > MAX_JOB_FILES || !manifest.records?.length) return { ready: false, bytes: 0 };
    const required = ["mlc-chat-config.json", "tensor-cache.json", ...(config.tokenizer_files?.length ? config.tokenizer_files : ["tokenizer.json"]), ...manifest.records.map((r) => r.dataPath)];
    const map = new Map(files.map((f) => [f.rel, f]));
    if (required.some((p) => !map.has(p))) return { ready: false, bytes: 0 };
    let bytes = 0;
    for (const f of files) {
      const path = helperFilePath(dir, f.rel);
      const s = await stat(path);
      if (!s.isFile() || !f.sha256 || !Number.isSafeInteger(f.bytes) || f.bytes <= 0 || s.size !== f.bytes) return { ready: false, bytes: 0 };
      bytes += s.size;
    }
    for (const r of manifest.records) {
      if (r.nbytes != null && Number(r.nbytes) !== map.get(r.dataPath)?.bytes) return { ready: false, bytes: 0 };
    }
    const wasm = files.find((f) => f.lib && f.rel.endsWith(".wasm"));
    if (!wasm) return { ready: false, bytes: 0 };
    const fd = await open(helperFilePath(dir, wasm.rel), "r");
    try {
      const header = Buffer.alloc(4);
      await fd.read(header, 0, 4, 0);
      if (!header.equals(Buffer.from([0, 97, 115, 109]))) return { ready: false, bytes: 0 };
    } finally { await fd.close(); }
    return { ready: true, bytes, revision: String(receipt.revision || "") };
  } catch { return { ready: false, bytes: 0 }; }
}

// One owner per model, including queued operations. Delete reserves its place
// before aborting earlier work, so a late adoption cannot recreate removed files.
const operations = new Map();
function modelOperation(key, kind, run) {
  const previous = operations.get(key);
  if (previous?.kind === kind && !previous.ctrl.signal.aborted) return previous.promise;
  const entry = { kind, ctrl: new AbortController(), previous, promise: null };
  entry.promise = (async () => {
    await previous?.promise.catch(() => undefined);
    entry.ctrl.signal.throwIfAborted();
    return run(entry.ctrl.signal);
  })().finally(() => {
    entry.previous = null;
    if (operations.get(key) === entry) operations.delete(key);
  });
  operations.set(key, entry);
  if (kind === "delete") {
    for (let p = previous; p; p = p.previous) if (p.kind !== "delete") p.ctrl.abort();
  }
  return entry.promise;
}

async function fileDigest(path, signal) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  return hash.digest("hex");
}

/** Adopt a complete pre-receipt installation locally. Never require a model
 * download merely to introduce the new manifest or cache identity. */
export function adoptLegacyHelper(dir, libraryRoot, wasmName, digest = fileDigest) {
  if (!/^[\w.+-]+\.wasm$/.test(wasmName || "")) return Promise.resolve(false);
  return modelOperation(dir, "adopt", adopt).catch(() => false);
  async function adopt(signal) {
    try {
      // A receipt which exists but fails validation is damaged, not legacy.
      try { await stat(join(dir, "anvil-model.json")); return false; } catch (e) { if (e.code !== "ENOENT") throw e; }
      const config = await readFile(join(dir, "mlc-chat-config.json"), "utf8").then(JSON.parse);
      let manifestText;
      try { manifestText = await readFile(join(dir, "tensor-cache.json"), "utf8"); }
      catch (e) { if (e.code !== "ENOENT") throw e; manifestText = await readFile(join(dir, "ndarray-cache.json"), "utf8"); }
      const manifest = JSON.parse(manifestText);
      if (!manifest.records?.length || manifest.records.length > MAX_JOB_FILES - 4) return false;
      const tokenizers = config.tokenizer_files?.length ? config.tokenizer_files : ["tokenizer.json"];
      const names = [...new Set(["mlc-chat-config.json", ...tokenizers, ...manifest.records.map((r) => r.dataPath)])];
      if (names.length + 2 > MAX_JOB_FILES) return false;
      for (const name of names) {
        signal.throwIfAborted();
        const size = (await stat(helperFilePath(dir, name))).size;
        const shard = manifest.records.find((r) => r.dataPath === name);
        if (!size || (shard?.nbytes != null && Number(shard.nbytes) !== size)) return false;
      }
      for (const name of tokenizers.filter((n) => n.endsWith(".json"))) if (!jsonFileOk(helperFilePath(dir, name))) return false;
      signal.throwIfAborted();
      const wasm = helperFilePath(dir, wasmName);
      try { await stat(wasm); }
      catch (e) { if (e.code !== "ENOENT") throw e; await copyFile(helperFilePath(libraryRoot, wasmName), wasm); }
      signal.throwIfAborted();
      await writeFile(join(dir, "tensor-cache.json"), manifestText);
      const files = [];
      for (const rel of [...names, "tensor-cache.json", wasmName]) {
        signal.throwIfAborted();
        const path = helperFilePath(dir, rel);
        const sha256 = await digest(path, signal);
        files.push({ rel, bytes: (await stat(path)).size, sha256, lib: rel === wasmName });
      }
      const revision = createHash("sha256").update(JSON.stringify(files)).digest("hex");
      const temp = join(dir, `receipt-${randomUUID()}.part`);
      try {
        signal.throwIfAborted();
        await writeFile(temp, JSON.stringify({ revision, files }));
        signal.throwIfAborted();
        await rename(temp, join(dir, "anvil-model.json"));
      } finally { await rm(temp, { force: true }); }
      return (await helperModelInfo(dir)).ready;
    } catch { return false; }
  }
}

export async function cancelHelperDownload(root, id) {
  const key = join(root, helperModelId(id));
  const pending = [];
  for (let job = operations.get(key); job; job = job.previous) {
    if (job.kind === "download" || job.kind === "adopt") {
      job.ctrl.abort();
      pending.push(job.promise);
    }
  }
  await Promise.allSettled(pending);
}

const artifactPattern = /^\.(download|previous)-(.+)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function modelArtifacts(root) {
  const groups = new Map();
  let dirs;
  try { dirs = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return groups; throw error; }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const match = artifactPattern.exec(dir.name);
    if (!match) continue;
    let id;
    try { id = helperModelId(match[2]); } catch { continue; }
    const group = groups.get(id) || [];
    group.push({ kind: match[1], path: join(root, dir.name) });
    groups.set(id, group);
  }
  return groups;
}

/** Run before IPC is exposed. Restore an old installation if an interrupted
 * directory swap hid it. A complete first download may also be published.
 * Never replace an existing directory or discard the only surviving original. */
export async function recoverHelperBundles(root) {
  const restored = [], issues = [];
  for (const [id, artifacts] of await modelArtifacts(root)) {
    const key = join(root, id);
    try {
      await modelOperation(key, "recover", async (signal) => {
        const current = await lstat(key).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
        if (!current) {
          const backups = artifacts.filter((a) => a.kind === "previous");
          for (const backup of backups) backup.time = (await stat(backup.path)).mtimeMs;
          backups.sort((a, b) => b.time - a.time);
          let candidate;
          for (const backup of backups) {
            if ((await helperModelInfo(backup.path)).ready) { candidate = backup; break; }
          }
          // Legacy bundles have no receipt yet; restore their original files too.
          candidate ??= backups[0];
          if (!candidate) {
            for (const stage of artifacts.filter((a) => a.kind === "download")) {
              if ((await helperModelInfo(stage.path)).ready) { candidate = stage; break; }
            }
          }
          if (candidate) {
            signal.throwIfAborted();
            await rename(candidate.path, key);
            restored.push(id);
          }
        }
        const ready = (await helperModelInfo(key)).ready;
        for (const artifact of artifacts) {
          signal.throwIfAborted();
          // Preserve backups and complete staged files when the visible model
          // cannot be validated. Only incomplete working copies are expendable.
          if (ready || (artifact.kind === "download" && !(await helperModelInfo(artifact.path)).ready)) {
            await rm(artifact.path, { recursive: true, force: true });
          }
        }
      });
    } catch (error) { issues.push({ id, error: error instanceof Error ? error.message : String(error) }); }
  }
  return { restored, issues };
}

export function deleteHelperBundle(root, id) {
  const name = helperModelId(id), key = join(root, name);
  return modelOperation(key, "delete", async () => {
    // Remove recovery copies first: an intentional delete must stay deleted
    // after the next app start, even if cleanup of the visible model fails.
    for (const artifact of (await modelArtifacts(root)).get(name) || []) {
      await rm(artifact.path, { recursive: true, force: true });
    }
    await rm(key, { recursive: true, force: true });
    return true;
  });
}

export function downloadHelperBundle(root, job, progress, download = downloadFile) {
  const id = helperModelId(job?.id);
  const key = join(root, id);
  return modelOperation(key, "download", install);

  async function install(signal) {
    if (!Array.isArray(job.files) || !job.files.length || job.files.length > MAX_JOB_FILES) throw new Error("Ungültige Modell-Dateiliste");
    const stage = join(root, `.download-${id}-${randomUUID()}`);
    const backup = join(root, `.previous-${id}-${randomUUID()}`);
    let backedUp = false;
    try {
      await mkdir(stage, { recursive: true });
      const receipt = [];
      const names = new Set();
      for (const f of job.files) {
        signal.throwIfAborted();
        if (!hfAllowed(f.url) || names.has(f.rel)) throw new Error("Ungültige Modell-Quelle oder doppelte Datei");
        names.add(f.rel);
        const dest = helperFilePath(stage, f.rel);
        const old = helperFilePath(key, f.rel);
        await mkdir(dirname(dest), { recursive: true });
        // Hardlinks keep the old complete model intact without copying weights.
        // downloadFile always replaces its destination atomically.
        for (const suffix of ["", ".http.json"]) {
          try { await link(old + suffix, dest + suffix); }
          catch { try { await copyFile(old + suffix, dest + suffix); } catch { /* first download */ } }
        }
        const r = await download(f.url, dest, jsonFileOk, { force: Boolean(job.update), signal });
        receipt.push({ rel: f.rel, lib: Boolean(f.lib), bytes: r.bytes, sha256: r.sha256 });
        progress({ id, rel: f.rel, done: receipt.length, total: job.files.length, bytes: r.bytes, skipped: r.skipped });
      }
      const revision = createHash("sha256").update(JSON.stringify(receipt)).digest("hex");
      await writeFile(join(stage, "anvil-model.json"), JSON.stringify({ revision, files: receipt }));
      if (!(await helperModelInfo(stage)).ready) throw new Error("Modell unvollständig: Gewichte, Tokenizer oder WASM fehlen bzw. haben falsche Größe.");
      signal.throwIfAborted();
      try { await rename(key, backup); backedUp = true; } catch (err) { if (err.code !== "ENOENT") throw err; }
      try { signal.throwIfAborted(); await rename(stage, key); }
      catch (err) { if (backedUp) await rename(backup, key); backedUp = false; throw err; }
      if (backedUp) await rm(backup, { recursive: true, force: true }).catch(() => undefined);
      return { ok: true, dir: key, revision };
    } finally { await rm(stage, { recursive: true, force: true }).catch(() => undefined); }
  }
}
