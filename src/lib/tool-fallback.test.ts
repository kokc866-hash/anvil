import assert from "node:assert/strict";
import { test } from "node:test";
import { shrinkTools, stripPayload } from "./tool-fallback.ts";

test("400 shrinks tools, never drops write_file", () => {
  const tools = [
    { function: { name: "write_file" } },
    { function: { name: "read_file" } },
    { function: { name: "mcp_call" } },
  ];
  const next = shrinkTools(tools);
  assert.ok(next?.some((t) => t.function.name === "write_file"));
  assert.ok(!next?.some((t) => t.function.name === "mcp_call"));
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
