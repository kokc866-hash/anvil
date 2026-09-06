import assert from "node:assert/strict";
import { test } from "node:test";
import { localChatUrl, sanitizeLocalPayload, ndjsonLineToSse, wrapOllamaResponse } from "./local-wire.ts";

test("only the Ollama provider switches to native chat, including custom ports/prefixes", () => {
  assert.equal(localChatUrl("ollama", "http://192.168.178.41:11434/v1"), "http://192.168.178.41:11434/api/chat");
  assert.equal(localChatUrl("ollama", "http://localhost:8010/ollama/v1"), "http://localhost:8010/ollama/api/chat");
  assert.equal(localChatUrl("ollama", "http://localhost:8010/api/chat"), "http://localhost:8010/api/chat");
  assert.equal(localChatUrl("custom", "http://localhost:11434/v1"), "http://localhost:11434/v1/chat/completions");
  assert.equal(localChatUrl("lmstudio", "http://localhost:1234/v1"), "http://localhost:1234/v1/chat/completions");
});

test("native history preserves thinking, tool arguments/results, images and all offered schemas", () => {
  const payload = {
    model: "qwen", stream: true, think: "low", keep_alive: "30m",
    options: { num_ctx: 256000, num_predict: 8192, temperature: 0.3, n_ctx: 256000, keep_alive: "30m" },
    max_tokens: 12, tool_choice: "required", temperature: 0.3,
    tools: [{ type: "function", function: { name: "mcp_call", parameters: { type: "object" } } }],
    messages: [
      { role: "user", content: [{ type: "text", text: "Bild" }, { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } }] },
      { role: "assistant", content: null, reasoning: "prüfe", tool_calls: [{ id: "call_1", type: "function", function: { name: "mcp_call", arguments: '{"server":"test"}' } }] },
      { role: "tool", tool_call_id: "call_1", content: "result" },
    ],
  };
  const before = JSON.stringify(payload);
  const wire = sanitizeLocalPayload("ollama", payload);
  assert.equal(wire.think, "low");
  assert.equal(wire.keep_alive, "30m");
  assert.deepEqual(wire.options, { num_ctx: 256000, num_predict: 8192, temperature: 0.3 });
  assert.equal(wire.max_tokens, undefined);
  assert.equal(wire.tool_choice, undefined);
  assert.equal(wire.temperature, undefined);
  assert.deepEqual(wire.tools, payload.tools);
  assert.deepEqual(wire.messages, [
    { role: "user", content: "Bild", images: ["aW1hZ2U="] },
    { role: "assistant", content: "", thinking: "prüfe", tool_calls: [{ type: "function", function: { name: "mcp_call", arguments: { server: "test" } } }] },
    { role: "tool", tool_name: "mcp_call", content: "result" },
  ]);
  assert.equal(JSON.stringify(payload), before, "retries/history must not mutate into the native format");
  assert.equal(sanitizeLocalPayload("custom", payload), payload);
  assert.equal(sanitizeLocalPayload("ollama", { ...payload, think: false }).think, false);
});

test("final JSON retains content, tools, completion reason and usage before DONE", () => {
  const result = ndjsonLineToSse(JSON.stringify({ message: { content: "fertig", thinking: "denke", tool_calls: [{ function: { index: 3, name: "read_file", arguments: { path: "a.py" } } }] }, done: true, done_reason: "length", prompt_eval_count: 64, eval_count: 12 }));
  const json = JSON.parse(result.split("\n")[0].slice(6));
  assert.equal(json.choices[0].delta.content, "fertig");
  assert.equal(json.choices[0].delta.reasoning, "denke");
  assert.equal(json.choices[0].delta.tool_calls[0].index, 3);
  assert.equal(json.choices[0].finish_reason, "length");
  assert.deepEqual(json.usage, { prompt_tokens: 64, completion_tokens: 12 });
  assert.ok(result.endsWith("data: [DONE]\n\n"));
});

test("NDJSON handles byte fragmentation, multiple tool chunks, EOF tails and cancellation", async () => {
  const lines = [
    { message: { thinking: "prüfe 🛠" }, done: false },
    { message: { tool_calls: [{ function: { name: "read_file", arguments: { path: "a" } } }] }, done: false },
    { message: { tool_calls: [{ function: { name: "mcp_call", arguments: {} } }] }, done: false },
    { message: { content: "Fertig" }, done: true, prompt_eval_count: 12, eval_count: 9 },
  ];
  const bytes = new TextEncoder().encode(lines.map((line) => JSON.stringify(line)).join("\n"));
  let index = 0;
  let canceled = false;
  const source = new ReadableStream<Uint8Array>({
    pull(controller) { if (index < bytes.length) controller.enqueue(bytes.slice(index, ++index)); else controller.close(); },
    cancel() { canceled = true; },
  });
  const body = await wrapOllamaResponse("http://host/api/chat", new Response(source)).text();
  const chunks = body.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));
  assert.equal(chunks[0].choices[0].delta.reasoning, "prüfe 🛠");
  assert.deepEqual(chunks.slice(1, 3).map((chunk) => chunk.choices[0].delta.tool_calls[0].index), [0, 1]);
  assert.equal(chunks[3].choices[0].delta.content, "Fertig");
  const open = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"done":true}\n')); },
    cancel() { canceled = true; },
  });
  await wrapOllamaResponse("http://host/api/chat", new Response(open)).text();
  assert.equal(canceled, true);
});

test("server errors, malformed JSON and truncated streams remain visible failures", async () => {
  for (const [body, error] of [
    ['{"error":"model not found"}\n', /model not found/],
    ['{"message":{"content":"partial"},"done":false}\n', /Abschluss fehlt/],
    ['{"message":', /ungültiges oder unvollständiges JSON/],
  ] as const) {
    await assert.rejects(wrapOllamaResponse("http://host/api/chat", new Response(body)).text(), error);
  }
  const response = new Response("unavailable", { status: 503 });
  assert.equal(wrapOllamaResponse("http://host/api/chat", response), response);
});
