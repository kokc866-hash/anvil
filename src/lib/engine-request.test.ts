import assert from "node:assert/strict";
import { test } from "node:test";
import { engineReady, planEngineRun } from "./engine-request.ts";
import type { EngineHit } from "./engines.ts";

const unity: EngineHit = {
  id: "unity",
  label: "Unity",
  root: "games/A",
  evidence: [],
  cmds: { editor: 'unity -projectPath "games/A"', test: 'unity -projectPath "games/A" -runTests' },
};
test("unsupported actions never silently run another action", () => {
  assert.throws(() => planEngineRun([unity], { action: "play" }), /unterstützt/);
  assert.throws(() => planEngineRun([unity]), /unterstützt/);
  assert.throws(() => planEngineRun([unity], { action: "delete" }), /Unbekannte/);
  assert.equal(planEngineRun([unity], { action: "editor" }).cmd, unity.cmds.editor);
});
test("multiple engine projects require an unambiguous root", () => {
  const other = { ...unity, root: "games/B" };
  assert.throws(() => planEngineRun([unity, other], { action: "editor" }), /Mehrere/);
  assert.throws(
    () => planEngineRun([unity, other], { action: "editor", engine: "unity" }),
    /Mehrere/,
  );
  assert.equal(
    planEngineRun([unity, other], { action: "editor", engine: "unity", projectRoot: "games/B" })
      .hit,
    other,
  );
  assert.throws(
    () => planEngineRun([unity], { action: "editor", projectRoot: "missing" }),
    /nicht eindeutig/,
  );
});
test("a reachable companion alone is not an installed engine", () => {
  assert.equal(engineReady(unity, { ok: true, bins: {} }), false);
  assert.equal(engineReady(unity, { ok: false, bins: { unity: "Unity.exe" } }), false);
  assert.equal(engineReady(unity, { ok: true, bins: { unity: "Unity.exe" } }), true);
  assert.equal(
    engineReady(
      { ...unity, id: "unreal" },
      { ok: true, bins: { UnrealEditor: "UnrealEditor.exe" } },
    ),
    true,
  );
});
