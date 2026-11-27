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
  assert.equal(c.finish_reason, "incomplete");
});

test("sse error surfaces", () => {
  const raw = 'data: {"type":"error","error":{"message":"model not found"}}\n\n';
  assert.throws(() => parseResponsesSse(raw), /model not found/);
});

test("nested failed Responses events retain the error instead of accepting partial output", () => {
  assert.throws(() => parseResponsesSse([
    'data: {"type":"response.output_text.delta","delta":"partial"}', '',
    'data: {"type":"response.failed","response":{"status":"failed","error":{"message":"backend stopped"}}}', '',
  ].join('\n')), /backend stopped/);
  assert.throws(() => parseResponses({ status: 'failed', error: { message: 'backend stopped' }, output_text: 'partial' }), /backend stopped/);
});

test("a failed event without a message still fails and partial EOF is never completed", () => {
  assert.throws(() => parseResponsesSse('data: {"type":"response.failed","response":{"status":"failed"}}\n\n'), /Fehler/);
  assert.throws(() => parseResponsesSse('data: {"type":"response.output_text.delta","delta":"partial"}\n\n'), /Abschluss fehlt/);
  assert.throws(() => parseResponsesSse('data: {\n\ndata: [DONE]\n\n'), /JSON/);
});

test("incomplete Responses retain their reason and reject partial tool calls", () => {
  for (const [reason, expected] of [['max_output_tokens', 'length'], ['content_filter', 'content_filter'], ['other_reason', 'incomplete']]) {
    const value = { status: 'incomplete', incomplete_details: { reason }, output_text: 'partial', output: [] };
    for (const choice of [parseResponses(value), parseResponsesSse(`data: ${JSON.stringify({ type: 'response.incomplete', response: value })}\n\n`)]) {
      assert.equal(choice.content, 'partial');
      assert.equal(choice.finish_reason, expected);
      assert.equal(choice.tool_calls, undefined);
    }
    const withTool = { ...value, output: [{ type: 'function_call', call_id: 'write', name: 'write_file', arguments: '{"path":' }] };
    assert.throws(() => parseResponses(withTool), /Werkzeugaufrufe wurden nicht ausgeführt/);
    assert.throws(() => parseResponsesSse(`data: ${JSON.stringify({ type: 'response.incomplete', response: withTool })}\n\n`), /Werkzeugaufrufe wurden nicht ausgeführt/);
  }
});

test("CRLF framing and named error events work on buffered Responses streams", () => {
  const complete = 'event: response.completed\r\ndata: {"response":{"output_text":"ready","status":"completed"}}\r\n\r\n';
  assert.equal(parseResponsesSse(complete).content, 'ready');
  assert.throws(() => parseResponsesSse('event: error\r\ndata: {"message":"named failure"}\r\n\r\n'), /named failure/);
});
