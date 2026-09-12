import assert from "node:assert/strict";
import { test } from "node:test";
import { compactMessages, fitMessages, isContextError, isVramError, prepChatPayload, estimatePrompt, shrinkLocalCtx, COMPACT_MARK } from "./compact.ts";

test("compact leaves a short list alone", () => {
  const msgs = [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
    { role: "tool", content: "x".repeat(20_000) },
  ];
  const r = compactMessages(msgs, 32_768, "auto");
  assert.equal(r.compacted, false);
  assert.equal(String(r.messages.at(-1)?.content).length, 20_000);
});

test("compact never clips the last tool result", () => {
  const rest = Array.from({ length: 12 }, (_, i) => ({ role: "user", content: `u${i} ${"y".repeat(4000)}` }));
  rest.push({ role: "tool", content: "FULLFILE\n" + "z".repeat(30_000) });
  const msgs = [{ role: "system", content: "sys ".repeat(2000) }, ...rest];
  const r = compactMessages(msgs, 8192, "auto");
  assert.equal(r.compacted, true);
  const last = String(r.messages.at(-1)?.content ?? "");
  assert.match(last, /FULLFILE/);
  assert.ok(last.length > 10_000);
});

test("fitMessages shrinks few huge messages to budget", () => {
  const msgs = [
    { role: "system", content: "A".repeat(1000) },
    { role: "user", content: "B".repeat(20_000) },
    { role: "assistant", content: "C".repeat(20_000) },
  ];
  const out = fitMessages(msgs, 2000);
  assert.ok(estimatePrompt(out) <= 2000);
  assert.equal(out[0].content, msgs[0].content);
});

test("prepChatPayload: prompt + max_tokens fits n_ctx", () => {
  const payload: Record<string, unknown> = {
    messages: [
      { role: "system", content: "sys ".repeat(3000) },
      { role: "user", content: "hi ".repeat(4000) },
      { role: "assistant", tool_calls: [{ id: "1", function: { name: "set_plan", arguments: "{}" } }] },
    ],
    max_tokens: 11468,
    options: { num_ctx: 32768, num_predict: 11468 },
  };
  prepChatPayload(payload, 32768);
  const prompt = estimatePrompt(payload.messages, payload.tools);
  const reply = Number(payload.max_tokens);
  assert.ok(prompt + reply + 64 <= 32768, `prompt ${prompt} + reply ${reply}`);
  const tc = (payload.messages as { tool_calls?: { type?: string }[] }[])[2]?.tool_calls?.[0];
  assert.equal(tc?.type, "function");
  assert.equal((payload.messages as { role: string }[])[0].role, "system");
});

test("llama.cpp 32k: 22k-Prompt plus 11k max_tokens muss unter n_ctx", () => {
  const payload: Record<string, unknown> = {
    messages: [{ role: "user", content: "x".repeat(21_665 * 4) }],
    max_tokens: 11_468,
    options: { num_ctx: 32_768, num_predict: 11_468 },
  };
  prepChatPayload(payload, 32_768);
  const prompt = estimatePrompt(payload.messages);
  const reply = Number(payload.max_tokens);
  assert.ok(prompt + reply + 64 <= 32_768, `noch ${prompt}+${reply}=${prompt + reply}`);
  assert.equal(Number((payload.options as { num_predict: number }).num_predict), reply);
});

test("isContextError catches llama.cpp and OpenAI", () => {
  assert.equal(isContextError("request (33133 tokens) exceeds the available context size (32768 tokens)"), true);
  assert.equal(isContextError("context_length_exceeded"), true);
  assert.equal(isContextError("prompt is too long"), true);
  assert.equal(isContextError("HTTP 400 bad tool"), false);
});

test("isVramError and shrinkLocalCtx", () => {
  assert.equal(isVramError("model requires more system memory"), true);
  assert.equal(isVramError("CUDA error: out of memory"), true);
  assert.equal(isVramError("prompt is too long"), false);
  assert.equal(shrinkLocalCtx(256000), 128000);
  assert.equal(shrinkLocalCtx(5000), 4096);
});

test("prepChatPayload keeps system when tools schema is huge", () => {
  const sys = "SYSTEMSTART " + "Regel ".repeat(400);
  const tools = Array.from({ length: 40 }, (_, i) => ({
    type: "function",
    function: {
      name: `t${i}`,
      description: "x".repeat(200),
      parameters: { type: "object", properties: { a: { type: "string" } } },
    },
  }));
  const payload: Record<string, unknown> = {
    messages: [
      { role: "system", content: sys },
      { role: "user", content: "Stelle fertig und schreib die Dateien." },
    ],
    tools,
    max_tokens: 11468,
    options: { num_ctx: 32768, num_predict: 11468 },
  };
  prepChatPayload(payload, 32768);
  const msgs = payload.messages as { role: string; content: string }[];
  assert.equal(msgs[0].role, "system");
  assert.match(msgs[0].content, /SYSTEMSTART/);
  assert.ok(msgs[0].content.length > 800, `system ${msgs[0].content.length}`);
  assert.match(String(msgs.at(-1)?.content), /Stelle fertig/);
});

test("compact digest keeps files and prior compact", () => {
  const oldUsers = Array.from({ length: 16 }, (_, i) => ({
    role: "user",
    content: i === 0 ? "Bau src/app.ts ohne Tailwind." : `u${i} ${"y".repeat(3000)}`,
  }));
  const msgs = [
    { role: "system", content: "sys ".repeat(200) },
    { role: "user", content: `${COMPACT_MARK}, 4 Nachrichten):\nZiel: Counter\nDateien: src/store.ts` },
    ...oldUsers,
    { role: "assistant", content: "ok" },
  ];
  const r = compactMessages(msgs, 8192, "auto");
  assert.equal(r.compacted, true);
  const blob = r.messages.find((m) => String(m.content ?? "").startsWith(COMPACT_MARK));
  assert.ok(blob);
  const text = String(blob?.content);
  assert.match(text, /src\/app\.ts|src\/store\.ts|Tailwind|Counter/);
});

test("estimatePrompt stubs data urls so they do not dominate the budget", () => {
  const img = "data:image/png;base64," + "A".repeat(80_000);
  const msgs = [
    { role: "system", content: "sys" },
    {
      role: "user",
      content: [
        { type: "text", text: "siehe screenshot" },
        { type: "image_url", image_url: { url: img } },
      ],
    },
  ];
  const n = estimatePrompt(msgs);
  assert.ok(n < 2000, String(n));
});


test("4k payload stays inside the same conservative budget after trimming", () => {
  const payload: Record<string, unknown> = { messages: [{ role: "system", content: "Short system." }, { role: "user", content: "x".repeat(24000) }], max_tokens: 1024 };
  prepChatPayload(payload, 4096);
  assert.ok(estimatePrompt(payload.messages, payload.tools) + Number(payload.max_tokens) + 192 <= 4096);
});

test("impossible tools or system budget fails explicitly without dropping contracts", () => {
  const tools = [{ type: "function", function: { name: "big", description: "x".repeat(20000) } }];
  const payload = { messages: [{ role: "user", content: "hi" }], tools, max_tokens: 1024 };
  assert.throws(() => prepChatPayload(payload, 4096), /Context window/);
  assert.deepEqual(payload.tools, tools);
  const system = { role: "system", content: "rules ".repeat(4000) };
  assert.throws(() => fitMessages([system, { role: "user", content: "hi" }], 2000), /Context window/);
  assert.equal(system.content, "rules ".repeat(4000));
});

test("explicit output length is honored when it fits, including small limits", () => {
  for (const limit of [16, 128, 16384]) {
    const payload = { messages: [{ role: "user", content: "Hallo" }], max_tokens: limit };
    prepChatPayload(payload, 32768);
    assert.equal(payload.max_tokens, limit);
  }
});

test("images reserve tokens without counting base64 as text", () => {
  const small = [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64," + "A".repeat(100) } }] }];
  const big = [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64," + "A".repeat(1000000) } }] }];
  assert.equal(estimatePrompt(small), estimatePrompt(big));
  assert.ok(estimatePrompt(small) >= 1536);
  assert.ok(estimatePrompt([...small, ...small]) >= 3072);
});


test("manual thinking retains valid room for both thinking and visible output", () => {
  const payload = { messages: [{ role: "system", content: "sys" }, { role: "user", content: "x".repeat(20000) }], max_tokens: 8192, thinking: { type: "enabled", budget_tokens: 4096 } };
  prepChatPayload(payload, 4096);
  assert.ok(payload.max_tokens >= 2048);
  assert.ok(payload.thinking.budget_tokens >= 1024);
  assert.ok(payload.thinking.budget_tokens <= payload.max_tokens - 1024);
  assert.ok(estimatePrompt(payload.messages) + payload.max_tokens + 192 <= 4096);
});
