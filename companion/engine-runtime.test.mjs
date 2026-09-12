import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { commandArgs, parseEngineCommand, engineArguments, engineBinaries, detectDiskEngines, selectEngineCommand, runEngineCommand } from "./engine-runtime.mjs";
import { activeRunCount, runStatus } from "./run-jobs.mjs";

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-engine-test-"));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  const put = (rel, content = "") => { const file = path.join(root, rel); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, content); return file; };
  return { root, put };
}

test("quoted engine paths retain spaces and Windows separators; invalid shell input fails", () => {
  assert.deepEqual(commandArgs('godot --path "C:\\Projects\\My Game (test)" ""'), ["godot", "--path", "C:\\Projects\\My Game (test)", ""]);
  assert.deepEqual(commandArgs("godot --path 'Games/Test & More'"), ["godot", "--path", "Games/Test & More"]);
  for (const cmd of ['godot --path "broken', 'godot && node other', 'godot\nnode', 'godot | node', '']) assert.throws(() => commandArgs(cmd));
});

test("godot command resolves godot4 alias; overrides are verified and fail closed", (t) => {
  const { root, put } = fixture(t);
  const file = put(process.platform === "win32" ? "godot4.exe" : "godot4");
  const env = { PATH: root };
  assert.equal(parseEngineCommand('godot --path "nested game"', { env }).file, file);
  assert.equal(engineBinaries({ ...env, ANVIL_GODOT_BIN: path.join(root, "missing") }).godot.file, null);
  assert.throws(() => parseEngineCommand("godot", { env: { ...env, ANVIL_GODOT_BIN: root } }), /existiert nicht/);
  assert.equal(parseEngineCommand("godot", { env: { ...env, ANVIL_GODOT_BIN: process.execPath } }).file, process.execPath);
  assert.throws(() => parseEngineCommand('"other/godot"', { env }), /stimmt nicht/);
});

test("Unity CLI is not reported as the Unity Editor on Windows", { skip: process.platform !== "win32" }, (t) => {
  const { root, put } = fixture(t);
  put("CLI/unity.exe");
  const env = { PATH: path.join(root, "CLI"), ProgramFiles: root };
  assert.equal(engineBinaries(env).unity.file, null);
  const editor = put("Unity/Hub/Editor/6000.3/Editor/Unity.exe");
  assert.equal(engineBinaries(env).unity.file, editor);
  put("Unity/Hub/Editor/6000.4/Editor/Unity.exe");
  assert.equal(engineBinaries(env).unity.file, null);
});

test("nested projects survive large trees and use their own project roots", (t) => {
  const { root, put } = fixture(t);
  for (let i = 0; i < 120; i++) put(`aaa/file${i}.txt`);
  put("Games/Deep/Folder/My Game/project.godot");
  put("Other/Unity/ProjectSettings/ProjectVersion.txt", "m_EditorVersion: 6000.3");
  mkdirSync(path.join(root, "Other/Unity/Assets"));
  put("Wrong/ProjectSettings/ProjectVersion.txt");
  mkdirSync(path.join(root, "Unrelated/Assets"), { recursive: true });
  put("UE/My Unreal/Game.uproject");
  put("Rust/Cargo.toml", '[dependencies]\nbevy = "0.16"');
  put("Fake/Cargo.toml", '# bevy game\n[package]\nname="other"');
  const found = detectDiskEngines(root);
  assert.equal(found.engines.length, 4);
  assert.equal(found.engines.find((h) => h.id === "godot").cmds.check, 'godot --headless --path "Games/Deep/Folder/My Game" --import');
  assert.equal(found.engines.find((h) => h.id === "unity").root, "Other/Unity");
  assert.equal(found.engines.find((h) => h.id === "unreal").cmds.editor, 'UnrealEditor "UE/My Unreal/Game.uproject"');
  assert.equal(found.engines.find((h) => h.id === "bevy").cmds.check, 'cargo check --manifest-path "Rust/Cargo.toml"');
  assert.throws(() => selectEngineCommand(found, { action: "editor" }), /Mehrere/);
  assert.throws(() => selectEngineCommand(found, { action: "check", engine: "unity" }), /nicht unterstützt/);
  assert.match(selectEngineCommand(found, { action: "editor", engine: "unity", projectRoot: "Other/Unity" }), /Other\/Unity/);
});

test("real engine process captures failure, timeout and managed detached lifecycle", async (t) => {
  const { root, put } = fixture(t);
  const oldInstall = process.env.ANVIL_INSTALL_DIR;
  process.env.ANVIL_INSTALL_DIR = root;
  t.after(() => { if (oldInstall == null) delete process.env.ANVIL_INSTALL_DIR; else process.env.ANVIL_INSTALL_DIR = oldInstall; });
  const env = { ...process.env, ANVIL_GODOT_BIN: process.execPath };
  const failure = put("bad.mjs", 'console.error("compile failed");process.exit(7)');
  const result = await runEngineCommand(root, `godot "${failure}"`, 3000, { env, action: "check" });
  assert.equal(result.ok, false);
  assert.equal(result.code, 7);
  assert.match(result.stderr, /compile failed/);
  const long = put("long.mjs", 'setTimeout(() => console.log("finished"), 900)');
  const timeout = await runEngineCommand(root, `godot "${long}"`, 100, { env, action: "check" });
  assert.equal(timeout.ok, false);
  assert.equal(timeout.timedOut, true);
  assert.match(timeout.stderr, /Zeitlimit/);
  const job = await runEngineCommand(root, `godot "${long}"`, 100, { env, action: "editor", readyMs: 200 });
  assert.equal(job.running, true);
  assert.equal(activeRunCount(), 1);
  assert.equal(runStatus(job.stage.id).running, true);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const done = runStatus(job.stage.id);
  assert.equal(done.ok, true);
  assert.equal(done.running, false);
  assert.match(done.stdout, /finished/);
  assert.equal(activeRunCount(), 0);
});

test("Godot import errors fail checks even when the engine exits zero; warnings remain successful", async (t) => {
  const { root, put } = fixture(t);
  const oldInstall = process.env.ANVIL_INSTALL_DIR;
  process.env.ANVIL_INSTALL_DIR = root;
  t.after(() => { if (oldInstall == null) delete process.env.ANVIL_INSTALL_DIR; else process.env.ANVIL_INSTALL_DIR = oldInstall; });
  const env = { ...process.env, ANVIL_GODOT_BIN: process.execPath };
  const invalid = put("invalid-import.mjs", 'console.error(\'SCRIPT ERROR: Parse Error: Expected end of statement after expression.\\n   at: GDScript::reload (res://main.gd:3)\\nERROR: Failed to load script "res://main.gd" with error "Parse error".\');');
  const checked = await runEngineCommand(root, `godot "${invalid}"`, 3000, { env, action: "check" });
  assert.equal(checked.code, 0, "keep the genuine process exit code for diagnosis");
  assert.equal(checked.ok, false, "the import did not pass merely because Godot returned zero");
  assert.match(checked.stderr, /Godot.*Fehler/);
  assert.equal(runStatus(checked.stage.id).ok, false);
  const stdoutError = put("stdout-error.mjs", 'console.log("\\x1b[31mERROR: Failed to import texture.\\x1b[0m");');
  const tested = await runEngineCommand(root, `godot "${stdoutError}"`, 3000, { env, action: "test" });
  assert.equal(tested.ok, false);
  const warning = put("warning.mjs", 'console.error("WARNING: Orphan StringName at exit"); console.log("Text mentioning ERROR: without a diagnostic prefix");');
  const warned = await runEngineCommand(root, `godot "${warning}"`, 3000, { env, action: "check" });
  assert.equal(warned.ok, true);
});

test("Unreal receives an absolute project descriptor inside the workspace", (t) => {
  const { root, put } = fixture(t);
  const project = put("Unreal Probe/AnvilProbe.uproject", "{}");
  const parsed = { engine: "UnrealEditor", args: ["Unreal Probe/AnvilProbe.uproject", "-unattended"] };
  assert.deepEqual(engineArguments(parsed, root), [project, "-unattended"]);
  assert.equal(parsed.args[0], "Unreal Probe/AnvilProbe.uproject", "normalizing a run does not mutate displayed commands");
  assert.throws(() => engineArguments({ engine: "UnrealEditor", args: ["../outside.uproject"] }, root), /außerhalb/);
  assert.throws(() => engineArguments({ engine: "UnrealEditor", args: ["missing.uproject"] }, root), /nicht gefunden/);
  assert.deepEqual(engineArguments({ engine: "godot", args: ["--path", "."] }, root), ["--path", "."]);
});
