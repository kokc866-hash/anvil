import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("token accounting across streams, tool rounds and session display", async (t) => {
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } }, server: { middlewareMode: true, hmr: false }, appType: "custom" });
  t.after(() => server.close());
  const { readSseChat, readSseAnthropic } = await server.ssrLoadModule("/src/lib/sse.ts");
  const { resolvedUsage, withRequestTokens } = await server.ssrLoadModule("/src/lib/token-usage.ts");
  const { beginAgent } = await server.ssrLoadModule("/src/lib/abort.ts");
  const { runAgentLoop } = await server.ssrLoadModule("/src/lib/agent-core.ts");
  const { useIde } = await server.ssrLoadModule("/src/store/ide.ts");
  const { ContextBar } = await server.ssrLoadModule("/src/components/ide/chat-context.tsx");
  const response = (events) => new Response(new ReadableStream({
    pull(controller) {
      if (!events.length) return controller.close();
      const event = events.shift();
      controller.enqueue(new TextEncoder().encode(`data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`));
    },
  }));

  await t.test("chat usage after finish_reason survives separate network chunks", async () => {
    for (const finish of ["stop", "tool_calls", "length"]) {
      beginAgent();
      const deltas = [];
      const delta = finish === "tool_calls" ? { tool_calls: [{ index: 0, id: "c1", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }] } : { content: "OK" };
      const choice = await readSseChat(response([
        { choices: [{ delta }] }, { choices: [{ delta: {}, finish_reason: finish }] },
        { choices: [], usage: { prompt_tokens: 1234, completion_tokens: 56 } }, "[DONE]",
      ]), (chunk) => deltas.push(chunk));
      assert.deepEqual(choice.usage, { prompt: 1234, completion: 56 });
      assert.equal(choice.finish_reason, finish);
      if (finish === "tool_calls") assert.equal(choice.tool_calls[0].function.arguments, '{"path":"a.ts"}');
      else assert.equal(deltas.join(""), "OK");
    }
  });
  await t.test("EOF works without DONE and a real zero is retained", async () => {
    beginAgent();
    const choice = await readSseChat(response([{ choices: [{ delta: { content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0 } }]));
    assert.deepEqual(resolvedUsage(choice, []), { prompt: 0, completion: 0, estimated: false });
  });
  await t.test("fragmented UTF-8 and a final usage event without newline survive EOF", async () => {
    beginAgent();
    const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Grüße"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":1234,"completion_tokens":56}}');
    let offset = 0;
    const res = new Response(new ReadableStream({ pull(c) { if (offset === bytes.length) return c.close(); c.enqueue(bytes.slice(offset, ++offset)); } }));
    const choice = await readSseChat(res);
    assert.equal(choice.content, "Grüße");
    assert.deepEqual(choice.usage, { prompt: 1234, completion: 56 });
  });
  await t.test("Anthropic merges cumulative start/delta usage including cached input", async () => {
    beginAgent();
    const choice = await readSseAnthropic(response([
      { type: "message_start", message: { usage: { input_tokens: 1234, output_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 } } },
      { type: "content_block_start", content_block: { type: "text" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "OK" } },
      { type: "message_delta", delta: {}, usage: { output_tokens: 12 } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 56 } },
      { type: "message_stop" },
    ]));
    assert.deepEqual(choice.usage, { prompt: 1354, completion: 56 });
    assert.equal(choice.content, "OK");
  });
  await t.test("partial usage estimates only missing fields and includes thinking/tools", () => {
    const c = resolvedUsage({ content: "OK", reasoning: "x".repeat(400), tool_calls: [{ arguments: "y".repeat(400) }], usage: { prompt: 0 } }, []);
    assert.equal(c.prompt, 0); assert.ok(c.completion >= 200); assert.equal(c.estimated, true);
    const invalid = resolvedUsage({ usage: { prompt: NaN, completion: -1 } }, [{ role: "user", content: "hi" }]);
    assert.ok(Number.isFinite(invalid.prompt)); assert.equal(invalid.estimated, true);
  });
  await t.test("each completed tool round is counted once, including missing usage", async () => {
    beginAgent(); let calls = 0; const recorded = [];
    const data = { messages: [{ role: "user", content: "Welche Dateien gibt es?" }], files: [], observeOnly: true, runLoop: false, afterWrite: "none", maxRounds: 3 };
    const result = await runAgentLoop(data, async (messages) => {
      for (const m of messages) { assert.equal(m.usage, undefined); assert.equal(m.requestTokens, undefined); }
      if (++calls === 1) return withRequestTokens({ role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "list_files", arguments: "{}" } }], usage: { prompt: 1234, completion: 56 } }, { messages }, 8192);
      return { role: "assistant", content: "Keine Dateien vorhanden." };
    }, { onUsage: (usage) => recorded.push(usage) });
    assert.equal(calls, 2); assert.equal(recorded.length, 2);
    assert.equal(result.usage.prompt, recorded[0].prompt + recorded[1].prompt);
    assert.equal(result.usage.completion, recorded[0].completion + recorded[1].completion);
    assert.equal(result.usage.estimated, true);
  });
  await t.test("completed rounds remain recorded when a later request fails", async () => {
    beginAgent(); let calls = 0; const recorded = [];
    await assert.rejects(runAgentLoop({ messages: [{ role: "user", content: "Dateien auflisten" }], files: [], observeOnly: true, maxRounds: 3 }, async () => {
      if (++calls > 1) throw new Error("HTTP 401");
      return { role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "list_files", arguments: "{}" } }], usage: { prompt: 100, completion: 5 } };
    }, { onUsage: (u) => recorded.push(u) }), /401/);
    assert.deepEqual(recorded, [{ prompt: 100, completion: 5, estimated: false }]);
  });
  await t.test("session handles zero, invalid counts and older estimated totals; UI uses actual request context", () => {
    useIde.setState({ locale: "de", sessionTokens: { prompt: 0, completion: 0, estimated: false }, lastRequestTokens: { prompt: 1234, limit: 8192, estimated: false }, llmContext: 32768 });
    useIde.getState().addSessionTokens(1234, 56, false);
    useIde.getState().addSessionTokens(0, 0, false);
    assert.deepEqual(useIde.getState().sessionTokens, { prompt: 1234, completion: 56, estimated: false });
    // React's server renderer reads getInitialState, not the client snapshot.
    const initial = useIde.getInitialState();
    const saved = { ...initial };
    Object.assign(initial, useIde.getState());
    let html;
    try { html = renderToStaticMarkup(React.createElement(ContextBar)); }
    finally { Object.assign(initial, saved); }
    assert.match(html, /1\.2k.*\/.*8k/);
    assert.doesNotMatch(html, /32k/);
    useIde.getState().addSessionTokens(NaN, -1, false);
    assert.deepEqual(useIde.getState().sessionTokens, { prompt: 1234, completion: 56, estimated: true });
    useIde.setState({ sessionTokens: { prompt: 100, completion: 20 } });
    useIde.getState().addSessionTokens(5, 1, false);
    assert.equal(useIde.getState().sessionTokens.estimated, true);
  });
});
