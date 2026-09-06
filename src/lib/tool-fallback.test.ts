import assert from "node:assert/strict";
import { test } from "node:test";
import { shrinkTools, stripPayload, prepareTextTools } from "./tool-fallback.ts";

test("400 never removes MCP or native tools", () => {
  const tools = [
    { function: { name: "write_file" } },
    { function: { name: "read_file" } },
    { function: { name: "mcp_call" } },
  ];
  const next = shrinkTools(tools);
  assert.ok(next?.some((t) => t.function.name === "write_file"));
  assert.ok(next?.some((t) => t.function.name === "mcp_call"));
});

test("strip 400 fields but leave tools", () => {
  const payload: Record<string, unknown> = { tools: [1], temperature: 0.2, think: true };
  stripPayload(payload, "");
  assert.equal(payload.tools != null, true);
  assert.equal(payload.temperature, undefined);
});

test("strip 400 swaps max_tokens to max_completion_tokens", () => {
  const payload: Record<string, unknown> = { max_tokens: 800, temperature: 0.3 };
  stripPayload(payload, "Unsupported parameter: 'max_tokens' is not supported. Use 'max_completion_tokens' instead.");
  assert.equal(payload.max_tokens, undefined);
  assert.equal(payload.max_completion_tokens, 800);
});

test("schema compaction preserves required, enums and properties named description", () => {
  const tools = [{ function: { name: "mcp_call", description: "long ".repeat(100), parameters: {
    type: "object", description: "Schema explanation", required: ["description"],
    properties: { description: { type: "string", description: "Argument explanation", enum: ["description", "other"] } },
    default: { description: "literal application data" },
  } } }];
  const next = shrinkTools(tools)!;
  const params = next[0].function.parameters;
  assert.deepEqual(params.required, ["description"]);
  assert.deepEqual(params.properties.description.enum, ["description", "other"]);
  assert.deepEqual(params.default, { description: "literal application data" });
  assert.equal(params.description, undefined);
  assert.equal(tools[0].function.parameters.description, "Schema explanation");
});

test("text-only model receives MCP contracts and tool history without broadening its tool list", () => {
  const payload: Record<string, unknown> = { messages: [{ role: "system", content: "Rules" }, { role: "tool", tool_call_id: "call1", content: "real result" }] };
  const tools = [{ function: { name: "mcp_call", parameters: { type: "object", properties: { server: { type: "string" } } } } }];
  prepareTextTools(payload, tools);
  prepareTextTools(payload, tools);
  const messages = payload.messages as { role: string; content: string }[];
  assert.match(messages[0].content, /mcp_call/);
  assert.match(messages[0].content, /server/);
  assert.doesNotMatch(messages[0].content, /write_file/);
  assert.equal(messages[0].content.split("Tool transport for this request").length, 2);
  assert.equal(messages[1].role, "user");
  assert.match(messages[1].content, /real result/);
});
