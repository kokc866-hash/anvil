import assert from "node:assert/strict";
import { test } from "node:test";
import { parseResponses, parseResponsesSse } from "./responses-parse.ts";

test("json responses", () => {
  const c = parseResponses({
    output_text: "hi",
    output: [{ type: "function_call", call_id: "1", name: "read_file", arguments: "{\"path\":\"a.ts\"}" }],
  });
  assert.equal(c.content, "hi");
  assert.equal(c.tool_calls?.[0]?.function.name, "read_file");
});

test("sse completed event", () => {
  const raw = [
    "event: response.output_text.delta",
    'data: {"type":"response.output_text.delta","delta":"Hallo"}',
    "",
    "event: response.completed",
    'data: {"type":"response.completed","response":{"output_text":"Hallo Welt","output":[]}}',
    "",
  ].join("\n");
  const c = parseResponsesSse(raw);
  assert.match(c.content || "", /Hallo Welt/);
});

test("sse function call", () => {
  const raw = [
    'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"c1","name":"write_file","arguments":"{\\"path\\":\\"x.ts\\"}"}}',
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  const c = parseResponsesSse(raw);
  assert.equal(c.tool_calls?.[0]?.function.name, "write_file");
});

test("incomplete stream still parses", () => {
  const raw = [
    'data: {"type":"response.incomplete","response":{"output_text":"halb","output":[]}}',
    "",
  ].join("\n");
  const c = parseResponsesSse(raw);
  assert.match(c.content || "", /halb/);
});

test("sse error surfaces", () => {
  const raw = 'data: {"type":"error","error":{"message":"model not found"}}\n\n';
  assert.throws(() => parseResponsesSse(raw), /model not found/);
});
