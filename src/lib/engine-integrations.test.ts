import assert from "node:assert/strict";
import { test } from "node:test";
import { ENGINE_INTEGRATIONS, createEngineIntegration } from "./engine-integrations.ts";
import { AgentEvidence } from "./agent-evidence.ts";

test("engine integration templates are inactive drafts and keep setup arguments separate", () => {
  assert.equal(new Set(ENGINE_INTEGRATIONS.map((p) => p.id)).size, 7);
  for (const item of ENGINE_INTEGRATIONS) {
    const draft = createEngineIntegration(item.id, {
      program: "I:/Tools/Unity Relay/relay_win.exe",
      cwd: "I:/Tools/Unreal MCP/Python",
    });
    assert.equal(draft.enabled, false);
    assert.equal(draft.transport, "stdio");
    assert.equal(draft.service, undefined);
    assert.equal(draft.auth, undefined);
    assert.notEqual(draft.args, item.args);
    assert.ok(draft.command);
    assert.equal(new URL(item.source).protocol, "https:");
    if (item.programRequired || item.cwdRequired)
      assert.throws(() => createEngineIntegration(item.id), /Pfad/);
  }
  assert.throws(() => createEngineIntegration("missing"), /Unbekannte/);
  assert.throws(
    () => createEngineIntegration("unity-official", { program: "relative.exe" }),
    /Pfad/,
  );
  assert.throws(() => createEngineIntegration("unreal-chongdashu", { cwd: "../outside" }), /Pfad/);
});

test("starting an editor cannot pass verification or erase a failed check", () => {
  const evidence = new AgentEvidence();
  evidence.record(
    "engine_run",
    { action: "editor", engine: "godot", projectRoot: "game" },
    { ok: true, running: true },
  );
  assert.equal(evidence.status().state, "none");
  evidence.record(
    "engine_run",
    { action: "check", engine: "godot", projectRoot: "game" },
    { ok: false, stderr: "parse error" },
  );
  evidence.record(
    "engine_run",
    { action: "editor", engine: "godot", projectRoot: "game" },
    { ok: true, running: true },
  );
  assert.equal(evidence.status().state, "failed");
  assert.match(evidence.status().detail, /parse error/);
  evidence.record("engine_run", { action: "check", engine: "godot", projectRoot: "game" }, { ok: true });
  assert.equal(evidence.status().state, "passed");
  evidence.changed();
  assert.equal(evidence.status().state, "stale");
  const closed = new AgentEvidence();
  closed.record("engine_run", { action: "editor" }, { ok: true, code: 0 });
  assert.equal(closed.status().state, "none");
});

test("engine evidence rejects information queries and matches implicit and explicit retries", () => {
  const info = new AgentEvidence();
  for (const cmd of ["godot --version", "UnrealEditor --help", "godot -h"]) {
    info.record("engine_run", { action: "check", cmd }, { ok: true });
    assert.equal(info.status().state, "none");
  }
  const retry = new AgentEvidence();
  retry.record("engine_run", { action: "check" }, { ok: false, engine: "Godot", projectRoot: "game" });
  assert.equal(retry.status().state, "failed");
  retry.record("engine_run", { action: "check", engine: "godot", projectRoot: "game" }, { ok: true, engineId: "godot" });
  assert.equal(retry.status().state, "passed");
});
