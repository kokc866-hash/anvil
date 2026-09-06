import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function runRoot() {
  const install = process.env.ANVIL_INSTALL_DIR || path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  return path.join(path.resolve(install), "runs");
}

export function createRunFolder(entry, cwd = "") {
  const name = path.basename(entry).replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 48) || "program";
  const key = createHash("sha256").update(`${cwd}\0${entry}`).digest("hex").slice(0, 12);
  const id = `${name}-${key}/${Date.now()}-${randomBytes(6).toString("hex")}`;
  const dir = path.join(runRoot(), id);
  const work = path.join(dir, "src"), out = path.join(dir, "out"), temporary = path.join(dir, "tmp");
  try {
    for (const folder of [work, out, temporary]) mkdirSync(folder, { recursive: true });
  } catch (error) {
    throw new Error(`Run-Ordner im Anvil-Installationsordner kann nicht angelegt werden: ${dir}. Schreibrechte für diesen Ordner benötigt. ${error.message}`);
  }
  return { id, dir, work, out, temporary, name };
}

export function runEnvironment(folders, base) {
  const cache = path.join(runRoot(), "cache");
  const zig = path.join(cache, "zig"), go = path.join(cache, "go"), modules = path.join(cache, "go-modules");
  for (const folder of [zig, go, modules]) mkdirSync(folder, { recursive: true });
  return { ...base, TEMP: folders.temporary, TMP: folders.temporary, TMPDIR: folders.temporary,
    ZIG_GLOBAL_CACHE_DIR: zig, ZIG_LOCAL_CACHE_DIR: path.join(folders.temporary, "zig"),
    GOCACHE: go, GOMODCACHE: modules, CARGO_TARGET_DIR: path.join(folders.out, "cargo"),
    PYTHONUNBUFFERED: "1", PYTHONUTF8: "1" };
}

export function saveRunRecord(folders, record) {
  writeFileSync(path.join(folders.dir, "run.json"), JSON.stringify(record, null, 2), "utf8");
  writeFileSync(path.join(folders.dir, "run.log"), [record.stdout, record.stderr].filter(Boolean).join("\n\n"), "utf8");
}
