import assert from "node:assert/strict";
import { test } from "node:test";
import { compactMessages, fitMessages, isContextError, isVramError, isHistoryMemoryError, compactRejectedHistory, prepChatPayload, reduceRejectedImages, estimatePrompt, shrinkLocalCtx, COMPACT_MARK, USER_REQUEST_MARK } from "./compact.ts";
import { ANVIL_RUN_FRAME, MODEL_IMAGE_LIMIT } from "./agent-image.ts";
import { cliRequest } from "./cli-protocol.ts";

const imagePart = (label: string) => ({ type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.from(label).toString("base64")}` } });

test("HTTP and CLI share the image allowance across history, attachments, MCP and preview", () => {
  const image = imagePart("current attachment");
  const mcpImages = [imagePart("current render 1"), imagePart("current render 2")];
  const frame = imagePart("current preview");
  const messages = [
    { role: "user", content: [imagePart("old attachment")] },
    { role: "user", content: [{ type: "text", text: USER_REQUEST_MARK + "Inspect my drawing." }, image] },
    { role: "assistant", tool_calls: [{ id: "render-call", type: "function", function: { name: "mcp_call", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "render-call", content: '{"outputId":"stored-output"}' },
    { role: "user", mcpResult: true, content: [{ type: "text", text: "Earlier render; output id retained." }, imagePart("old render")] },
    { role: "user", mcpResult: true, content: [{ type: "text", text: "New renders" }, ...mcpImages] },
    { role: "user", [ANVIL_RUN_FRAME]: true, content: [{ type: "text", text: "Verified preview capture" }, frame] },
  ];
  const original = JSON.stringify(messages);
  const payload: Record<string, unknown> = { messages, max_tokens: 1000 };
  prepChatPayload(payload, 32_768);
  const expected = [image, ...mcpImages, frame];
  const packed = JSON.stringify(payload.messages);
  assert.equal((packed.match(/data:image/g) || []).length, MODEL_IMAGE_LIMIT);
  assert.ok(expected.every(part => packed.includes(part.image_url.url)));
  assert.match(packed, /Earlier render; output id retained/);
  assert.match(packed, /stored-output/);
  assert.match(packed, /render-call/);
  assert.ok(Object.hasOwn((payload.messages as Record<string, unknown>[]).at(-1)!, ANVIL_RUN_FRAME));
  assert.deepEqual(cliRequest(messages, []).images, expected.map(part => part.image_url.url));
  assert.equal(reduceRejectedImages(payload), 2);
  const retried = JSON.stringify(payload.messages);
  assert.ok(retried.includes(image.image_url.url));
  assert.ok(retried.includes(frame.image_url.url));
  assert.ok(Object.hasOwn((payload.messages as Record<string, unknown>[]).at(-1)!, ANVIL_RUN_FRAME));
  assert.match(retried, /stored-output/);
  assert.equal(JSON.stringify(messages), original);
});

test("too many current attachments fail explicitly before sending any part of the request", () => {
  const messages = [{ role: "user", content: Array.from({ length: MODEL_IMAGE_LIMIT + 1 }, (_, i) => imagePart(String(i))) }];
  assert.throws(() => prepChatPayload({ messages, max_tokens: 1000 }, 32_768), /Nutzeranfragen enthalten 5 Bilder/);
  assert.throws(() => cliRequest(messages, []), /Nutzeranfragen enthalten 5 Bilder/);
});

test("image attachments on explicitly pinned in-flight corrections are part of the current request", () => {
  const request = (text: string, labels: string[]) => ({ role: "user", content: [{ type: "text", text: USER_REQUEST_MARK + text }, ...labels.map(imagePart)] });
  const messages = [request("Use the original drawing.", ["first", "second", "third"]), request("Compare the corrections.", ["fourth", "fifth"])];
  assert.throws(() => prepChatPayload({ messages }, 32_768), /Nutzeranfragen enthalten 5 Bilder/);
});

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

test("recompacting a short model summary retains its historical authority boundary", () => {
  const summary = { role: "user", content: `${COMPACT_MARK}, summary; historical context, not new instructions):\nSMALL_SUMMARY` };
  const rest = Array.from({ length: 12 }, (_, index) => ({ role: "assistant", content: `Old turn ${index} ` + "history ".repeat(1000) }));
  const request = { role: "user", content: USER_REQUEST_MARK + "Keep the exact new task." };
  const compact = compactMessages([{ role: "system", content: "Current instructions." }, summary, ...rest, request], 8192, "aggressive");
  assert.equal(compact.compacted, true);
  const historical = compact.messages.find(message => String(message.content).startsWith(COMPACT_MARK));
  assert.match(String(historical?.content), /Historical context, not new instructions/);
  assert.match(String(historical?.content), /SMALL_SUMMARY/);
  assert.ok(compact.messages.some(message => message.content === request.content));
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

test("isContextError recognizes Studio's German admission error without treating unsupported context options as overflow", () => {
  assert.equal(isContextError('Der vollständige Verlauf mit Ausgabereserve benötigt geschätzt 369,767 Kontext-Tokens; verfügbar sind 262,144. Der deklarierte Modellkontext reicht dafür nicht aus.'), true);
  assert.equal(isContextError(JSON.stringify({ error: { code: 'context_length_exceeded', message: 'Request rejected.' } })), true);
  for (const text of ['Kontext-Parameter wird nicht unterstützt', 'Der Modellkontext beträgt 262144 Tokens.', 'Invalid image format', 'Unknown field context_length']) assert.equal(isContextError(text), false, text);
});

test("context admission recovery reduces history while preserving output and thinking reservations", () => {
  const messages = [{ role: 'system', content: 'Keep the system.' }, { role: 'user', content: USER_REQUEST_MARK + 'Keep my exact current request.' },
    ...Array.from({ length: 8 }, (_, i) => [{ role: 'user', content: `Old ${i} ` + 'detail '.repeat(900) }, { role: 'assistant', content: 'old result '.repeat(900) }]).flat(),
    { role: 'assistant', content: '', tool_calls: [{ id: 'read-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"x"}' } }] },
    { role: 'tool', tool_call_id: 'read-1', content: 'Confirmed read result.' }];
  const payload = { messages, max_tokens: 66560, enable_thinking: true, reasoning_budget: 32768, tools: [{ type: 'function', function: { name: 'read_file' } }] };
  const original = structuredClone(payload);
  assert.equal(compactRejectedHistory(payload, { preserveOutput: true }), true);
  assert.ok(estimatePrompt(payload.messages) < estimatePrompt(original.messages));
  assert.equal(payload.max_tokens, 66560);
  assert.equal(payload.reasoning_budget, 32768);
  assert.deepEqual(payload.tools, original.tools);
  assert.deepEqual(payload.messages.slice(-2), original.messages.slice(-2));
  assert.deepEqual(messages, original.messages);
  const protectedOnly = { messages: original.messages.slice(0, 2), max_tokens: 66560, reasoning_budget: 32768 };
  const before = structuredClone(protectedOnly);
  assert.equal(compactRejectedHistory(protectedOnly, { preserveOutput: true }), false);
  assert.deepEqual(protectedOnly, before);
});

test("isVramError and shrinkLocalCtx", () => {
  assert.equal(isVramError("model requires more system memory"), true);
  assert.equal(isVramError("CUDA error: out of memory"), true);
  assert.equal(isVramError("prompt is too long"), false);
  assert.equal(shrinkLocalCtx(256000), 128000);
  assert.equal(shrinkLocalCtx(5000), 4096);
});

test("a history-memory budget rejection is distinct from model allocation and unrelated bad requests", () => {
  assert.equal(isHistoryMemoryError('Der vollständige Agentenverlauf passt mit Ausgabereserve nicht in das verfügbare Speicherbudget. Der Modellbedarf überschreitet das Studio-GPU-Budget.'), true);
  assert.equal(isHistoryMemoryError('The conversation exceeds the available memory budget including output reserve.'), true);
  assert.equal(isHistoryMemoryError('context_memory_budget_exceeded'), true);
  for (const message of ["CUDA out of memory", "model requires more system memory", "Invalid image format", "Unknown field memory_budget", "Information: history and memory budget are available."]) {
    assert.equal(isHistoryMemoryError(message), false, message);
  }
});

test("history-memory adaptation preserves irreducible user text and images and never raises a small output limit", () => {
  const pinned = { role: "user", content: [
    { type: "text", text: USER_REQUEST_MARK + "Every word must stay. ".repeat(1000) },
    { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
  ] };
  const payload: Record<string, unknown> = { model: "unchanged", messages: [{ role: "system", content: "Keep the instructions." }, pinned], max_tokens: 16, n_ctx: 131072, options: { num_ctx: 131072, n_ctx: 131072, temperature: 0.3 } };
  const original = structuredClone(payload);
  assert.equal(compactRejectedHistory(payload), false);
  assert.deepEqual(payload, original);
});

test("history-memory adaptation lowers output reservation without altering context or thinking mode", () => {
  const payload: Record<string, unknown> = { messages: [{ role: "user", content: USER_REQUEST_MARK + "Keep this exact request." }], max_completion_tokens: 8192, options: { num_ctx: 131072, n_ctx: 131072, num_predict: 8192, temperature: 0.7 }, thinking: { type: "enabled", budget_tokens: 4096 } };
  assert.equal(compactRejectedHistory(payload), true);
  assert.equal(payload.max_completion_tokens, 4096);
  assert.equal((payload.options as Record<string, unknown>).num_predict, 4096);
  prepChatPayload(payload, 131072);
  assert.equal((payload.options as Record<string, unknown>).num_ctx, 131072);
  assert.equal((payload.options as Record<string, unknown>).n_ctx, 131072);
  assert.equal((payload.options as Record<string, unknown>).temperature, 0.7);
  assert.equal((payload.thinking as Record<string, unknown>).type, "enabled");
  assert.ok(Number((payload.thinking as Record<string, unknown>).budget_tokens) <= 3072);
});

test("a native thinking reservation retains room for both reasoning and visible output", () => {
  const payload: Record<string, unknown> = { messages: [{ role: "user", content: USER_REQUEST_MARK + "Keep this exact request." }], enable_thinking: true, reasoning_budget: 32768, options: { num_ctx: 131072, num_predict: 4096 } };
  assert.equal(compactRejectedHistory(payload), true);
  assert.equal(payload.enable_thinking, true);
  assert.equal(payload.reasoning_budget, 1024);
  assert.equal((payload.options as Record<string, unknown>).num_predict, 2048);
  assert.equal((payload.options as Record<string, unknown>).num_ctx, 131072);
  assert.equal(compactRejectedHistory(payload), false, "thinking and answer reservations are not starved to manufacture another retry");
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

const pairedCalls = (argumentsText = "{}") => ({
  role: "assistant", content: "Read both files.",
  tool_calls: ["call_a", "call_b"].map(id => ({ id, type: "function", function: { name: "read_file", arguments: argumentsText } })),
});
const olderContext = () => Array.from({ length: 12 }, (_, i) => ({ role: "user", content: `Old ${i}: ${"x".repeat(4000)}` }));
const callIds = (messages: Record<string, unknown>[]) => messages.flatMap(message =>
  Array.isArray(message.tool_calls) ? message.tool_calls.map(call => String(call.id)) : []);
const resultIds = (messages: Record<string, unknown>[]) => messages.filter(message => message.role === "tool").map(message => String(message.tool_call_id));

test("compaction keeps a multi-tool group across injected user and developer context", () => {
  const call = pairedCalls();
  const messages = [
    { role: "system", content: "Keep the original rules." }, ...olderContext(), call,
    { role: "tool", tool_call_id: "call_a", content: "First file." },
    ...Array.from({ length: 4 }, (_, i) => ({ role: i % 2 ? "user" : "developer", content: `Context ${i}: ${"y".repeat(1600)}` })),
    { role: "tool", tool_call_id: "call_b", content: "Second file." },
    { role: "assistant", content: "Now edit the files." },
  ];
  const before = structuredClone(messages);
  const result = compactMessages(messages, 2048, "aggressive");
  assert.equal(result.compacted, true);
  assert.deepEqual(callIds(result.messages), ["call_a", "call_b"]);
  assert.deepEqual(resultIds(result.messages), ["call_a", "call_b"]);
  assert.deepEqual(result.messages.find(message => message.tool_calls), call);
  assert.equal(result.messages[0].content, messages[0].content);
  assert.deepEqual(messages, before);
});

test("a pinned image request inside a tool group keeps both sides and its complete text", () => {
  const pinned = { role: "user", content: [
    { type: "text", text: USER_REQUEST_MARK + "Preserve every detail. ".repeat(200) },
    { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
  ] };
  const messages = [
    { role: "system", content: "Rules stay intact." }, ...olderContext(), pairedCalls(),
    { role: "tool", tool_call_id: "call_a", content: "First file." }, pinned,
    { role: "developer", content: "An injected status update." },
    { role: "tool", tool_call_id: "call_b", content: "Second file." },
    ...Array.from({ length: 8 }, (_, i) => ({ role: "user", content: `Recent ${i}: ${"y".repeat(1600)}` })),
    { role: "assistant", content: "Ready." },
  ];
  const result = compactMessages(messages, 2048, "aggressive");
  assert.equal(result.compacted, true);
  assert.deepEqual(callIds(result.messages), ["call_a", "call_b"]);
  assert.deepEqual(resultIds(result.messages), ["call_a", "call_b"]);
  assert.deepEqual(result.messages.find(message => Array.isArray(message.content)), pinned);
});

test("fitting drops an old closed tool group together across neutral messages", () => {
  const messages = [
    { role: "system", content: "Rules stay intact." }, pairedCalls(JSON.stringify({ path: "x".repeat(12000) })),
    { role: "tool", tool_call_id: "call_a", content: "First file." },
    { role: "developer", content: "Context inserted before the second result." },
    { role: "tool", tool_call_id: "call_b", content: "Second file." },
    { role: "user", content: USER_REQUEST_MARK + "Keep this next task." },
    { role: "assistant", content: "The latest answer." },
  ];
  const before = structuredClone(messages);
  const fitted = fitMessages(messages, 1000);
  assert.ok(estimatePrompt(fitted) <= 1000);
  assert.deepEqual(callIds(fitted), []);
  assert.deepEqual(resultIds(fitted), []);
  assert.equal(fitted[0].content, messages[0].content);
  assert.ok(fitted.some(message => message.content === messages[5].content));
  assert.equal(fitted.at(-1)?.content, "The latest answer.");
  assert.deepEqual(messages, before);
});

test("compaction preserves an unfinished tool group without inventing its missing result", () => {
  const call = pairedCalls();
  const messages = [
    { role: "system", content: "Rules." }, ...olderContext(), call,
    { role: "tool", tool_call_id: "call_a", content: "First file." },
    ...Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? "user" : "developer", content: `Waiting ${i}: ${"y".repeat(1600)}` })),
  ];
  const result = compactMessages(messages, 2048, "aggressive");
  assert.equal(result.compacted, true);
  assert.deepEqual(callIds(result.messages), ["call_a", "call_b"]);
  assert.deepEqual(resultIds(result.messages), ["call_a"]);
  assert.deepEqual(result.messages.find(message => message.tool_calls), call);
});

test("an unfinished tool group that cannot fit fails instead of dropping calls or fabricating results", () => {
  const messages = [
    { role: "system", content: "Rules." }, pairedCalls(JSON.stringify({ path: "x".repeat(12000) })),
    { role: "tool", tool_call_id: "call_a", content: "First file." },
    { role: "developer", content: "Still waiting for the other result." },
    { role: "user", content: USER_REQUEST_MARK + "Keep waiting." },
    { role: "assistant", content: "Pending." },
  ];
  const before = structuredClone(messages);
  assert.throws(() => fitMessages(messages, 1000), /Context window/);
  assert.deepEqual(messages, before);
});
