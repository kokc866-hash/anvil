import assert from "node:assert/strict";
import { test } from "node:test";
import { mcpArguments } from "./mcp-schema.ts";
import { modelMcpResult, readMcpOutput, forgetMcpOutputs } from "./mcp-results.ts";
import { unwrapMcp } from "./mcp-parse.ts";
import { AGENT_TOOLS } from "./agent-tools.ts";
import { ToolSession } from "./tool-compat.ts";
import { toolsAllowed } from "./surface.ts";

test("MCP arguments honor nested schemas and inject only declared, correctly typed context", () => {
  const schema = {
    type: "object",
    properties: {
      q: { type: "string" },
      n: { type: "integer", minimum: 1 },
      opts: {
        type: "object",
        required: ["on"],
        properties: { on: { type: "boolean" } },
        additionalProperties: false,
      },
    },
    required: ["q"],
    additionalProperties: false,
  };
  assert.deepEqual(
    mcpArguments(
      schema,
      { q: "explicit" },
      { q: "ignored", n: "3", opts: '{"on":true}', project: "drop" },
      "C:\\Workspace",
    ),
    { q: "explicit", n: 3, opts: { on: true } },
  );
  assert.throws(() => mcpArguments(schema, { q: "ok", cwd: "unasked" }), /additional properties/);
  assert.throws(() => mcpArguments(schema, { q: "ok", opts: { on: "true" } }), /boolean/);
  assert.throws(() => mcpArguments(schema, { q: "ok" }, { n: "no" }), /JSON/);
  assert.throws(() => mcpArguments(schema, []), /JSON-Objekt/);
  const legacy = {
    ...schema,
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://fixture.invalid/schema",
  };
  assert.equal(mcpArguments(legacy, { q: "first" }).q, "first");
  assert.equal(mcpArguments({ ...legacy, description: "changed" }, { q: "updated" }).q, "updated");
});

test("large MCP results retain structured content, all images and errors and can be read without replay", () => {
  const raw = {
    content: [
      { type: "text", text: "x".repeat(30000) },
      { type: "image", mimeType: "image/png", data: "AAAA" },
      { type: "image", mimeType: "image/png", data: "BBBB" },
    ],
    structuredContent: { answer: 42 },
    isError: true,
  };
  const result = modelMcpResult("server", unwrapMcp(raw));
  assert.equal(result.isError, true);
  assert.equal(result.truncated, true);
  assert.equal((result.mcpImages as string[]).length, 2);
  let text = "",
    offset: number | null = 0;
  while (offset !== null) {
    const page = readMcpOutput(String(result.outputId), ["server"], offset, 10000);
    text += page.text;
    offset = page.nextOffset;
  }
  const restored = JSON.parse(text);
  assert.deepEqual(restored.content, raw.content);
  assert.deepEqual(restored.structuredContent, { answer: 42 });
  assert.throws(() => readMcpOutput(String(result.outputId), ["other"]), /nicht mehr verfügbar/);
  forgetMcpOutputs("server");
  assert.throws(() => readMcpOutput(String(result.outputId), ["server"]), /nicht mehr verfügbar/);
});

test("exclusive MCP is usable in the first compact round without MCP keywords", () => {
  const allowed = AGENT_TOOLS.filter((t) => toolsAllowed("docs", "exclusive", t.function.name));
  const tools = new ToolSession("compact", "Suche die Projektbeschreibung")
    .tools(allowed)
    .map((t) => t.function.name);
  for (const name of ["mcp_list", "mcp_call", "mcp_read_resource", "mcp_read_output"])
    assert.ok(tools.includes(name), name);
  assert.ok(tools.length <= 8);
  assert.ok(!tools.includes("write_file"));
});
