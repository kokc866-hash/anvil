import path from "node:path";
import { statSync, readdirSync, readFileSync } from "node:fs";
import { insideRoot, runAllowed, whichExts } from "./guard.mjs";
import { spawnRun } from "./run-process.mjs";
import { createRunFolder, saveRunRecord } from "./run-storage.mjs";
import { beginRun, endRun } from "./run-jobs.mjs";

const ENGINES = {
  godot: { aliases: ["godot", "godot4"], env: "ANVIL_GODOT_BIN" },
  unity: { aliases: ["unity", "Unity"], env: "ANVIL_UNITY_BIN" },
  UnrealEditor: { aliases: ["UnrealEditor"], env: "ANVIL_UNREAL_BIN" },
};
const isFile = (file) => { try { return statSync(file).isFile(); } catch { return false; } };

function unityEditor(env) {
  const candidate = findBinary("Unity", env) || findBinary("unity", env);
  // Unity's new CLI uses the same name. It cannot execute Editor arguments.
  if (candidate && (process.platform !== "win32" || path.basename(path.dirname(candidate)).toLowerCase() === "editor")) return candidate;
  if (process.platform !== "win32") return null;
  const hub = path.join(env.ProgramFiles || "C:/Program Files", "Unity", "Hub", "Editor");
  let versions = [];
  try { versions = readdirSync(hub, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.isSymbolicLink()); } catch { return null; }
  const installed = versions.map((v) => path.join(hub, v.name, "Editor", "Unity.exe")).filter(isFile);
  // Multiple versions need an explicit choice, not an implicit project upgrade.
  return installed.length === 1 ? installed[0] : null;
}

export function findBinary(bin, env = process.env) {
  for (const dir of (env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const ext of whichExts()) {
      const file = path.join(dir.replace(/^"|"$/g, ""), bin + ext);
      if (isFile(file)) return file;
    }
  }
  if (process.platform === "win32" && ["python", "python3"].includes(bin)) return findBinary("py", env);
  return null;
}

export function engineBinaries(env = process.env) {
  return Object.fromEntries(Object.entries(ENGINES).map(([id, spec]) => {
    const configured = String(env[spec.env] || "").trim().replace(/^"|"$/g, "");
    // A broken explicit setting must not silently launch another installed version.
    const file = configured
      ? (path.isAbsolute(configured) && isFile(configured) ? configured : null)
      : id === "unity" ? unityEditor(env) : spec.aliases.map((alias) => findBinary(alias, env)).find(Boolean) || null;
    return [id, { file, configured: Boolean(configured), setting: spec.env,
      ...(configured && !file ? { error: `${spec.env}: Die angegebene ausführbare Datei existiert nicht oder ihr Pfad ist nicht absolut.` } : {}) }];
  }));
}

/** Tokenization only: no shell, expansion, redirection or command chaining. */
export function commandArgs(cmd) {
  const raw = String(cmd || "").trim();
  if (!raw) throw new Error("cmd fehlt");
  const out = [];
  let word = "", quote = "", started = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (/[\r\n\0]/.test(ch)) throw new Error("Zeilenumbrüche im Befehl sind verboten");
    if (quote) {
      if (ch === quote) quote = "";
      else if (ch === "\\" && raw[i + 1] === quote && quote === '"') { word += quote; i++; }
      else word += ch;
    } else if (ch === '"' || ch === "'") { quote = ch; started = true; }
    else if (/\s/.test(ch)) { if (started) { out.push(word); word = ""; started = false; } }
    else if (/[;&|`$()<>]/.test(ch)) throw new Error("Shell-Metazeichen müssen als wörtliches Argument in Anführungszeichen stehen");
    else { word += ch; started = true; }
  }
  if (quote) throw new Error("Nicht geschlossene Anführungszeichen im Befehl");
  if (started) out.push(word);
  if (!out[0]) throw new Error("Binärdatei fehlt");
  return out;
}

export function parseEngineCommand(cmd, { env = process.env, resolveBin = () => null } = {}) {
  const [requested, ...args] = commandArgs(cmd);
  const base = path.basename(requested).replace(/\.exe$/i, "");
  const engine = Object.entries(ENGINES).find(([, spec]) => spec.aliases.some((alias) => alias.toLowerCase() === base.toLowerCase()));
  if (!engine && !runAllowed(base)) throw new Error(`Binärdatei nicht erlaubt: ${base}`);
  const status = engine ? engineBinaries(env)[engine[0]] : null;
  const file = status ? status.file : findBinary(base, env) || resolveBin(base);
  if (!file) throw new Error(status?.error || `${base} nicht gefunden.${status ? ` ${status.setting} auf den vollständigen Programmpfad setzen oder die Engine zum PATH hinzufügen.` : ""}`);
  // An explicit command path cannot substitute an unrelated binary with an allowed name.
  if (requested !== path.basename(requested) && path.resolve(requested).toLowerCase() !== path.resolve(file).toLowerCase()) {
    throw new Error("Der Programmpfad stimmt nicht mit der gefundenen oder konfigurierten Binärdatei überein.");
  }
  return { file, args, engine: engine?.[0] };
}

const quote = (s) => `"${String(s).replaceAll('"', '\\"')}"`;
const SKIP = new Set(["node_modules", "Library", "Temp", "Obj", "Logs", "Build", "Builds", "Binaries", "Intermediate", "Saved", "DerivedDataCache", "target"]);

/** Breadth-first, bounded directory scan. Files cannot exhaust the directory budget. */
export function detectDiskEngines(root, { maxDirectories = 10000, maxDepth = 12 } = {}) {
  const engines = [], queue = [{ dir: root, depth: 0 }];
  let visited = 0, depthLimited = false;
  while (queue.length && visited < maxDirectories) {
    const { dir, depth } = queue.shift();
    visited++;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    const files = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
    const dirs = new Set(entries.filter((e) => e.isDirectory() && !e.isSymbolicLink()).map((e) => e.name));
    const rel = path.relative(root, dir).replaceAll("\\", "/");
    const at = (name) => rel ? `${rel}/${name}` : name;
    const add = (id, evidence, cmds) => engines.push({ id, root: rel, evidence: evidence.map(at), cmds });
    const p = quote(rel || ".");
    if (files.has("project.godot")) add("godot", ["project.godot"], {
      play: `godot --path ${p}`, editor: `godot --editor --path ${p}`,
      check: `godot --headless --path ${p} --import`,
    });
    if (dirs.has("Assets") && dirs.has("ProjectSettings") && isFile(path.join(dir, "ProjectSettings", "ProjectVersion.txt"))) {
      add("unity", ["ProjectSettings/ProjectVersion.txt"], {
        editor: `unity -projectPath ${p}`,
        test: `unity -projectPath ${p} -batchmode -runTests -testPlatform playmode -logFile -`,
      });
    }
    for (const file of files) if (file.endsWith(".uproject")) add("unreal", [file], { editor: `UnrealEditor ${quote(at(file))}` });
    if (files.has("Cargo.toml")) {
      try {
        const manifest = readFileSync(path.join(dir, "Cargo.toml"), "utf8");
        if (/^\s*bevy\s*(?:=|\.)|^\s*\[(?:[^\]\n]+\.)?dependencies\.bevy\]/m.test(manifest)) {
          const m = quote(at("Cargo.toml"));
          add("bevy", ["Cargo.toml"], { play: `cargo run --manifest-path ${m}`, check: `cargo check --manifest-path ${m}`, test: `cargo test --manifest-path ${m}` });
        }
      } catch { /* Unreadable manifests do not confirm an engine. */ }
    }
    if (files.has("main.lua") && files.has("conf.lua")) add("love", ["main.lua", "conf.lua"], { play: `love ${p}` });
    if (files.has("game.project")) add("defold", ["game.project"], {});
    for (const file of files) if (file.endsWith(".yyp")) add("gms", [file], {});
    if (depth < maxDepth) for (const name of [...dirs].sort()) {
      if (!name.startsWith(".") && !SKIP.has(name)) queue.push({ dir: path.join(dir, name), depth: depth + 1 });
    }
    else if ([...dirs].some((name) => !name.startsWith(".") && !SKIP.has(name))) depthLimited = true;
  }
  return { root, engines, truncated: depthLimited || queue.length > 0 };
}

export function selectEngineCommand(found, args) {
  if (args.cmd) return String(args.cmd);
  const candidates = found.engines.filter((hit) => (!args.engine || hit.id === args.engine) && (args.projectRoot == null || hit.root === args.projectRoot));
  if (candidates.length !== 1) throw new Error(candidates.length ? "Mehrere Engine-Projekte gefunden. engine und projectRoot auswählen." : "Kein passendes Engine-Projekt gefunden.");
  const action = String(args.action || "check");
  const cmd = candidates[0].cmds[action];
  if (!cmd) throw new Error(`Die Aktion ${action} wird für ${candidates[0].id} nicht unterstützt.`);
  return cmd;
}

export function engineArguments(parsed, cwd) {
  const args = [...parsed.args];
  if (parsed.engine === "UnrealEditor" && /\.uproject$/i.test(args[0] || "")) {
    // Unreal changes its working directory during boot; relative descriptors break.
    const project = path.resolve(cwd, args[0]);
    if (!insideRoot(cwd, project)) throw new Error("Unreal-Projekt liegt außerhalb des Workspace.");
    if (!isFile(project)) throw new Error("Die Unreal-Projektdatei wurde im Workspace nicht gefunden.");
    args[0] = project;
  }
  return args;
}

function checkedEngineResult(result, engine, action) {
  if (engine !== "godot" || !["check", "test"].includes(action) || result.running) return result;
  // Godot's import process can report a script/asset failure and still exit zero.
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  if (!/^\s*(?:SCRIPT ERROR|ERROR):/m.test(output)) return result;
  return { ...result, ok: false, stderr: [result.stderr, "Godot hat Fehler gemeldet; die Prüfung ist fehlgeschlagen."].filter(Boolean).join("\n") };
}

/** Editor/play are managed jobs; checks remain bounded and report their actual exit. */
export async function runEngineCommand(cwd, cmd, timeoutMs, { action = "", env = process.env, resolveBin, readyMs } = {}) {
  let folders;
  try {
    const parsed = parseEngineCommand(cmd, { env, resolveBin });
    const args = engineArguments(parsed, cwd);
    const detached = ["editor", "play"].includes(action);
    folders = createRunFolder(`engine-${parsed.engine || path.basename(parsed.file)}`, cwd);
    beginRun(folders.id);
    const pack = (result) => ({ ...checkedEngineResult(result, parsed.engine, action), cmd, stage: { kind: result.running ? "window" : "log", id: folders.id, out: folders.out } });
    let exited;
    const limit = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 30 * 60 * 1000) : 120000;
    const result = await spawnRun(parsed.file, args, cwd, limit, env, {
      detach: detached, show: detached, readyMs,
      stdoutFile: path.join(folders.dir, "stdout.log"), stderrFile: path.join(folders.dir, "stderr.log"),
      onExit(exit) { exited = exit; endRun(folders.id); try { saveRunRecord(folders, pack(exit)); } catch { /* Phase logs remain available. */ } },
    });
    const record = pack(exited || result);
    if (!record.running) endRun(folders.id);
    saveRunRecord(folders, record);
    return record;
  } catch (error) {
    if (folders) endRun(folders.id);
    return { ok: false, code: 1, stdout: "", stderr: error.message, duration: 0, cmd };
  }
}
