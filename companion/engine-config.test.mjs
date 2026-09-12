import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { readEngineConfig, saveEngineConfig, engineEnvironment } from "./engine-config.mjs";

test("engine configuration persists validated paths atomically, clears them, and respects environment precedence", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "anvil-engine-config-"));
  t.after(() => { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); rmSync(root, { recursive: true, force: true }); });
  const file = path.join(root, "config/engine-paths.json");
  const godot = path.join(root, "Godot.exe"); writeFileSync(godot, "fixture");
  const unity = path.join(root, "Editor/Unity.exe"); mkdirSync(path.dirname(unity)); writeFileSync(unity, "fixture");
  assert.deepEqual(readEngineConfig(file), { godot: "", unity: "", unreal: "" });
  saveEngineConfig({ godot, unity }, file);
  const saved = readEngineConfig(file);
  assert.equal(saved.godot, godot);
  assert.equal(saved.unity, unity);
  const before = readFileSync(file, "utf8");
  assert.throws(() => saveEngineConfig({ godot: "", unreal: "missing.exe" }, file), /Vollständigen/);
  assert.equal(readFileSync(file, "utf8"), before);
  assert.throws(() => saveEngineConfig({ anything: godot }, file));
  assert.equal(engineEnvironment({ ANVIL_GODOT_BIN: "explicit" }, saved).ANVIL_GODOT_BIN, "explicit");
  assert.equal(engineEnvironment({}, saved).ANVIL_UNITY_BIN, unity);
  saveEngineConfig({ godot: "" }, file);
  assert.equal(readEngineConfig(file).godot, "");
  assert.equal(readEngineConfig(file).unity, unity);
});
