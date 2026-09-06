import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANVIL_SURFACE,
  mergeMcpArgs,
  parseContext,
  surfaceBlockWrite,
  surfacePrompt,
  toolsAllowed,
} from "./surface.ts";

describe("surface", () => {
  it("parses key=value context", () => {
    assert.deepEqual(parseContext("scene=overworld\nproject=voidling"), {
      scene: "overworld",
      project: "voidling",
    });
    assert.equal(parseContext("overworld").target, "overworld");
  });
  it("merges context into mcp args without overwrite", () => {
    const a = mergeMcpArgs({ scene: "a", project: "p" }, { scene: "keep" });
    assert.equal(a.scene, "keep");
    assert.equal(a.project, "p");
  });
  it("blocks anvil writes on exclusive mcp", () => {
    assert.ok(surfaceBlockWrite("ziva", "exclusive", "write_file"));
    assert.equal(surfaceBlockWrite("ziva", "bridge", "write_file"), null);
    assert.equal(surfaceBlockWrite(ANVIL_SURFACE, "exclusive", "write_file"), null);
    assert.equal(surfaceBlockWrite("ziva", "exclusive", "mcp_call"), null);
  });
  it("exclusive mcp blocks anvil file tools", () => {
    assert.equal(toolsAllowed("ziva", "exclusive", "mcp_call"), true);
    assert.equal(toolsAllowed("ziva", "exclusive", "mcp_list"), true);
    assert.equal(toolsAllowed("ziva", "exclusive", "set_plan"), true);
    assert.equal(toolsAllowed("ziva", "exclusive", "ask_user"), true);
    assert.equal(toolsAllowed("ziva", "exclusive", "read_file"), false);
    assert.equal(toolsAllowed("ziva", "exclusive", "write_file"), false);
    assert.equal(toolsAllowed("ziva", "bridge", "read_file"), true);
    assert.equal(toolsAllowed(ANVIL_SURFACE, "exclusive", "write_file"), true);
  });
  it("prompt names the active mcp surface", () => {
    const t = surfacePrompt({
      id: "ziva",
      mode: "exclusive",
      label: "Ziva",
      tools: [{ server: "Ziva", name: "open_scene", description: "open a scene" }],
      resources: [{ server: "Ziva", uri: "scene://overworld", name: "overworld" }],
      context: { scene: "overworld" },
      ready: true,
    });
    assert.match(t, /Ziva/);
    assert.match(t, /open_scene/);
    assert.match(t, /scene=overworld/);
    assert.match(t, /mcp_call/);
    assert.doesNotMatch(t, /Anvil \(Dateien/);
  });
});

it("Anvil exposes configured MCP servers even before their catalog arrives", () => {
  const prompt = surfacePrompt({ id: ANVIL_SURFACE, mode: "exclusive", label: "Anvil", tools: [], resources: [], context: {}, ready: true,
    servers: [{ id: "docs", name: "Docs", ready: false }] });
  assert.match(prompt, /docs/);
  assert.match(prompt, /mcp_list/);
  assert.doesNotMatch(prompt, /nicht aktiv|Nur nutzen wenn/);
});
