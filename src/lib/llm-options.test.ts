import assert from "node:assert/strict";
import { test } from "node:test";
import { applyLlmOptions, applyResponsesStore, clampMaxOut, needsCompletionTokens, normalizeThinking, patchResponses400, responsesBody, toResponsesInput, toolDetail, usesResponsesApi } from "./llm-options.ts";
import { effectiveThinking, thinkingModes } from "../../electron/thinking-support.mjs";
import { prepChatPayload } from "./compact.ts";

test("MCP trace keeps the target and redacts the rejection reason", () => {
  const args = { server: 'mcp:blender-local', name: 'execute_blender_code', arguments: { code: 'private input' } };
  const target = 'mcp:blender-local.execute_blender_code';
  assert.equal(toolDetail('mcp_call', args, { ok: true, text: 'private tool output' }), target);
  const detail = toolDetail('mcp_call', args, { ok: false, error: 'Nur prüfen. Authorization: Bearer fake-token-for-mcp-tests' });
  assert.match(detail, /execute_blender_code.*Nur prüfen\./);
  assert.doesNotMatch(detail, /fake-token|private input/);
  assert.match(toolDetail('mcp_call', args, { isError: true, text: 'Blender: Kamera fehlt.' }), /Kamera fehlt/);
});

test("Qwen cloud uses documented effort levels and never sends mutually exclusive reasoning controls", () => {
  assert.deepEqual(thinkingModes("qwen", "qwen3.8-flash"), ["off", "auto", "low", "medium", "xhigh"]);
  assert.equal(thinkingModes("qwen", "qwen3.8-2.4t-a95b").includes("off"), false);
  assert.deepEqual(thinkingModes("qwen", "qwen3-coder-next"), ["auto"]);
  assert.deepEqual(thinkingModes("qwen", "unknown-future"), ["auto"]);
  const make = (model: string, thinking: "off" | "auto" | "low" | "medium" | "high" | "xhigh") => applyLlmOptions({ stream: true }, { provider: "qwen", model, thinking, context: 131072 });
  const modern = make("qwen3.8-flash", "medium");
  assert.equal(modern.reasoning_effort, "medium");
  assert.equal(modern.thinking_budget, undefined);
  assert.equal(modern.enable_thinking, true);
  assert.deepEqual(modern.stream_options, { include_usage: true });
  assert.equal(make("qwen3.8-max", "off").enable_thinking, false);
  assert.equal(make("qwen3.8-max", "auto").reasoning_effort, undefined);
  assert.equal(make("qwen3.8-max", "auto").enable_thinking, undefined);
  const legacy = make("qwen3.5-plus", "high");
  assert.equal(legacy.enable_thinking, true);
  assert.ok(Number(legacy.thinking_budget) > 0);
  assert.equal(legacy.reasoning_effort, undefined);
  const unknown = make("unknown-future", "high");
  assert.equal(unknown.enable_thinking, undefined);
  assert.equal(unknown.reasoning_effort, undefined);
});

test("DeepSeek current aliases expose off, auto and the native low/high/max effort", () => {
  assert.deepEqual(thinkingModes("deepseek", "deepseek-flash"), ["off", "auto", "low", "high", "max"]);
  const p = applyLlmOptions({}, { provider: "deepseek", model: "deepseek-flash", thinking: "max", context: 131072 });
  assert.deepEqual(p.thinking, { type: "enabled" });
  assert.equal(p.reasoning_effort, "max");
  assert.equal(p.temperature, undefined, "temperature is ignored in DeepSeek thinking mode");
});

test("cloud tool histories preserve reasoning_content separately, without changing messages or other providers", () => {
  const messages = [{ role: "assistant", content: "", reasoning: "fixture reasoning", tool_calls: [{ id: "c", type: "function", function: { name: "read_file", arguments: "{}" } }] }, { role: "tool", tool_call_id: "c", content: "fixture" }];
  const before = JSON.stringify(messages);
  for (const provider of ["qwen", "deepseek"]) {
    const payload = applyLlmOptions({ messages }, { provider, model: "unknown", thinking: "auto", context: 32768 }, { tools: true });
    const wire = payload.messages as Record<string, unknown>[];
    assert.equal(wire[0].reasoning_content, "fixture reasoning");
    assert.equal(wire[0].reasoning, undefined);
    assert.equal(wire[0].content, "");
  }
  assert.equal(JSON.stringify(messages), before);
  assert.equal(applyLlmOptions({ messages }, { provider: "ollama", model: "qwen3.8", thinking: "auto", context: 32768 }).messages, messages);
});

test("Fable explicit effort uses adaptive thinking, never a legacy budget", () => {
  const p = applyLlmOptions({}, { provider: "anthropic", model: "claude-fable-5", context: 200000, thinking: "high" });
  assert.deepEqual(p.thinking, { type: "adaptive", display: "summarized" });
  assert.deepEqual(p.output_config, { effort: "high" });
});

test("gpt-5 o3 o4 grok-4 use max_completion_tokens", () => {
  assert.equal(needsCompletionTokens("gpt-5.6-luna"), true);
  assert.equal(needsCompletionTokens("openai/gpt-5-mini"), true);
  assert.equal(needsCompletionTokens("o3-mini"), true);
  assert.equal(needsCompletionTokens("openai/o3"), true);
  assert.equal(needsCompletionTokens("grok-4.5"), true);
  assert.equal(needsCompletionTokens("gpt-4o"), false);
  assert.equal(needsCompletionTokens("claude-sonnet-4", "anthropic"), false);
  assert.equal(needsCompletionTokens("llama3.1", "ollama"), false);
});

test("gpt-5 without thinking still drops max_tokens and temperature", () => {
  const p = applyLlmOptions(
    { model: "gpt-5.6-luna", temperature: 0.3 },
    { provider: "openai", model: "gpt-5.6-luna", api: "openai", context: 32768, thinking: "off" },
  );
  assert.equal("max_tokens" in p, false);
  assert.equal(typeof p.max_completion_tokens, "number");
  assert.equal("temperature" in p, false);
});

test("gpt-4o and gemini keep max_tokens", () => {
  for (const model of ["gpt-4o", "gemini-2.5-flash", "mistral-large", "deepseek-chat"]) {
    const p = applyLlmOptions(
      { model, temperature: 0.3 },
      { provider: "openai", model, api: "openai", context: 32768, thinking: "off" },
    );
    assert.equal(typeof p.max_tokens, "number", model);
    assert.equal("max_completion_tokens" in p, false, model);
  }
});

test("anthropic keeps max_tokens and thinking budget below it", () => {
  const p = applyLlmOptions(
    { model: "claude-sonnet-4", temperature: 0.3 },
    { provider: "anthropic", model: "claude-sonnet-4", api: "anthropic", context: 200000, thinking: "high" },
  );
  const max = p.max_tokens as number;
  const budget = (p.thinking as { budget_tokens: number }).budget_tokens;
  assert.ok(max > budget);
  assert.equal("max_completion_tokens" in p, false);
});

test("azure gpt-5 uses completion tokens", () => {
  const p = applyLlmOptions(
    { temperature: 0.3 },
    { provider: "azure", model: "gpt-5.1", api: "azure", context: 32768, thinking: "off" },
  );
  assert.equal("max_tokens" in p, false);
  assert.equal(typeof p.max_completion_tokens, "number");
});

test("gpt-5 with tools keeps app thinking, not none", () => {
  const p = applyLlmOptions(
    { model: "gpt-5.6-sol", temperature: 0.3 },
    { provider: "openai", model: "gpt-5.6-sol", api: "openai", context: 32768, thinking: "high" },
    { tools: true },
  );
  assert.equal(p.reasoning_effort, "high");
  assert.notEqual(p.reasoning_effort, "none");
});

test("gpt-5.6 thinking off explicitly disables reasoning", () => {
  const p = applyLlmOptions(
    { model: "gpt-5.6-sol" },
    { provider: "openai", model: "gpt-5.6-sol", api: "openai", context: 32768, thinking: "off" },
    { tools: true },
  );
  assert.equal(p.reasoning_effort, "none");
});

test("model-specific Thinking levels, mandatory reasoning and saved levels", () => {
  assert.deepEqual(thinkingModes("anthropic", "claude-fable-5"), ["auto", "low", "medium", "high", "xhigh", "max"]);
  assert.equal(thinkingModes("anthropic", "claude-sonnet-4-6").includes("xhigh"), false);
  assert.equal(thinkingModes("openai", "gpt-5.5").includes("max"), false);
  assert.equal(thinkingModes("openai", "gpt-6-astra").includes("off"), false);
  assert.deepEqual(thinkingModes("ollama", "qwen3"), ["off", "auto", "low", "medium", "high"]);
  assert.deepEqual(thinkingModes("openai", "gpt-4o"), ["auto"]);
  assert.equal(effectiveThinking("openai", "gpt-5.5", "max"), "auto");
  for (const mode of ["minimal", "xhigh", "max"] as const) assert.equal(normalizeThinking(mode), mode);
  assert.equal(normalizeThinking("injected"), "auto");
});

test("cloud reasoning reaches provider-native payloads and Responses", () => {
  const make = (provider: string, model: string, thinking: "off" | "auto" | "low" | "high" | "xhigh" | "max") =>
    applyLlmOptions({}, { provider, model, context: 32768, thinking, temperature: 0.7, maxOut: 4096 });
  const openai = make("openai", "gpt-5.6-terra", "max");
  assert.equal(openai.reasoning_effort, "max");
  assert.equal((responsesBody(openai, "openai").reasoning as { effort: string }).effort, "max");
  assert.equal(make("openai", "gpt-5.6-terra", "auto").reasoning_effort, undefined);
  assert.deepEqual(make("anthropic", "claude-opus-5", "max").output_config, { effort: "max" });
  assert.deepEqual(make("anthropic", "claude-sonnet-5", "off").thinking, { type: "disabled" });
  assert.deepEqual(make("anthropic", "claude-fable-5", "off").thinking, { type: "adaptive", display: "summarized" });
  assert.equal(make("google", "gemini-2.5-flash", "off").reasoning_effort, "none");
  assert.equal(make("google", "gemini-2.5-pro", "off").reasoning_effort, undefined);
  const gemini = make("google", "gemini-3.8-flash", "low");
  assert.equal(gemini.reasoning_effort, "low");
  assert.equal(gemini.temperature, 0.7);
  assert.equal(gemini.max_tokens, 4096);
  const router = make("openrouter", "anthropic/claude-fable-5", "max");
  assert.deepEqual(router.reasoning, { effort: "max" });
  assert.equal(router.reasoning_effort, undefined);
  assert.equal(make("xai", "grok-4.5", "low").reasoning_effort, "low");
  assert.equal(make("xai", "grok-4.5", "xhigh").reasoning_effort, undefined);
  const deepseek = make("deepseek", "deepseek-v4-pro", "max");
  assert.deepEqual(deepseek.thinking, { type: "enabled" });
  assert.equal(deepseek.reasoning_effort, "max");
});

test("legacy Claude auto uses a valid budget and GPT-6 keeps its required Responses tool transport", () => {
  const old = applyLlmOptions({}, { provider: "anthropic", model: "claude-sonnet-4-5", thinking: "auto", context: 32768 });
  assert.equal((old.thinking as { type: string }).type, "enabled");
  assert.equal(old.output_config, undefined);
  assert.equal(usesResponsesApi({ provider: "openai", model: "gpt-6-astra", thinking: "off", context: 32768 }, true), true);
});

test("responses api when gpt-5 tools and thinking on", () => {
  const rt = { provider: "openai", model: "gpt-5.6-sol", api: "openai" as const, context: 32768, thinking: "high" as const };
  assert.equal(usesResponsesApi(rt, true), true);
  assert.equal(usesResponsesApi({ ...rt, thinking: "off" }, true), false);
  assert.equal(usesResponsesApi(rt, false), false);
  assert.equal(usesResponsesApi({ ...rt, provider: "codex" }, true), false);
  assert.equal(usesResponsesApi({ ...rt, model: "gpt-6-astra" }, true), true);
});

test("responses store is always false", () => {
  const body = applyResponsesStore(
    { model: "gpt-5.6-luna", max_output_tokens: 8000, temperature: 0.3, user: "x" },
    "codex",
  );
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.equal(body.parallel_tool_calls, false);
  assert.equal("max_output_tokens" in body, false);
  assert.equal("temperature" in body, false);
  assert.equal("user" in body, false);
  assert.equal("include" in body, false);
});

test("openai api responses keeps max_output_tokens", () => {
  const body = applyResponsesStore({ model: "gpt-5.6-sol", max_output_tokens: 8000 }, "openai");
  assert.equal(body.store, false);
  assert.equal(body.max_output_tokens, 8000);
  assert.equal(body.stream, true);
  assert.deepEqual(body.include, ["reasoning.encrypted_content"]);
});

test("patchResponses400 strips unsupported and sets required flags", () => {
  const body: Record<string, unknown> = { model: "x", max_output_tokens: 1, store: true, reasoning_effort: "high" };
  assert.equal(patchResponses400(body, '{"detail":"Unsupported parameter: max_output_tokens"}'), true);
  assert.equal("max_output_tokens" in body, false);
  assert.equal(patchResponses400(body, '{"detail":"Store must be set to false"}'), true);
  assert.equal(body.store, false);
  assert.equal(patchResponses400(body, '{"detail":"Stream must be set to true"}'), true);
  assert.equal(body.stream, true);
  assert.equal(patchResponses400(body, "does not support parameter reasoningEffort"), true);
  assert.equal("reasoning_effort" in body, false);
  body.top_p = 0.9;
  assert.equal(patchResponses400(body, `{"error":{"message":"Unsupported parameter: 'top_p' is not supported","param":"top_p"}}`), true);
  assert.equal("top_p" in body, false);
});

test("patchResponses400 never deletes required input", () => {
  const body: Record<string, unknown> = {
    model: "gpt-5.6-luna",
    input: [{ role: "user", content: "hi" }],
  };
  const raw = JSON.stringify({
    error: {
      message: "Missing required parameter: 'input'.",
      type: "invalid_request_error",
      param: "input",
      code: "missing_required_parameter",
    },
  });
  patchResponses400(body, raw);
  assert.ok(Array.isArray(body.input) && (body.input as unknown[]).length > 0);
  assert.equal(body.model, "gpt-5.6-luna");
});

test("toResponsesInput fills empty when only system", () => {
  const { input, instructions } = toResponsesInput([{ role: "system", content: "sys" }]);
  assert.equal(instructions, "sys");
  assert.ok(input.length >= 1);
});

test("toResponsesInput drops orphan function_call_output", () => {
  const { input } = toResponsesInput([
    { role: "user", content: "go" },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_write_1", type: "function", function: { name: "write_file", arguments: "{}" } }],
    },
    { role: "tool", tool_call_id: "call_write_1", content: "ok" },
    { role: "tool", tool_call_id: "auto_run_2", content: "compiler ok" },
  ]);
  const outs = input.filter((x) => x && typeof x === "object" && (x as { type?: string }).type === "function_call_output") as {
    call_id: string;
  }[];
  assert.deepEqual(
    outs.map((o) => o.call_id),
    ["call_write_1"],
  );
  assert.ok(input.some((x) => x && typeof x === "object" && (x as { content?: string }).content === "compiler ok"));
});

test("responsesBody always sends input", () => {
  const body = responsesBody({ model: "gpt-5.6-sol", messages: [{ role: "system", content: "s" }] }, "openai");
  assert.ok(Array.isArray(body.input) && (body.input as unknown[]).length > 0);
});

test("provider wire: gpt-5 tools+think uses responses, grok/ollama/claude do not", () => {
  const gpt = { provider: "openai", model: "gpt-5.6-luna", api: "openai" as const, context: 32768, thinking: "high" as const };
  assert.equal(usesResponsesApi(gpt, true), true);
  assert.equal(usesResponsesApi({ ...gpt, provider: "codex" }, true), false);
  assert.equal(usesResponsesApi({ ...gpt, provider: "openrouter", model: "openai/gpt-5.5" }, true), false);
  assert.equal(usesResponsesApi({ ...gpt, provider: "github", model: "gpt-5.5" }, true), false);
  assert.equal(usesResponsesApi({ ...gpt, provider: "azure" }, true), true);
  assert.equal(usesResponsesApi({ provider: "xai", model: "grok-4.5", api: "openai", context: 131072, thinking: "high" }, true), false);
  assert.equal(usesResponsesApi({ provider: "ollama", model: "qwen3.8:27b", api: "openai", context: 32768, thinking: "low" }, true), false);
  assert.equal(usesResponsesApi({ provider: "anthropic", model: "claude-sonnet-4-5", api: "anthropic", context: 200000, thinking: "high" }, true), false);
  assert.equal(usesResponsesApi({ provider: "groq", model: "llama-3.3-70b-versatile", api: "openai", context: 32768, thinking: "off" }, true), false);
});

test("ollama thinking: no 8k cap, think level, no max_tokens", () => {
  const p = applyLlmOptions(
    { model: "qwen3.8:27b" },
    { provider: "ollama", model: "qwen3.8:27b", api: "openai", context: 131072, thinking: "high" },
  );
  const opt = p.options as { num_predict: number; think?: unknown; num_ctx: number };
  assert.equal("max_tokens" in p, false);
  assert.equal(p.think, "high");
  assert.equal("think" in opt, false);
  assert.equal(opt.num_ctx, 131072);
  assert.equal("enable_thinking" in p, false);
  assert.ok(opt.num_predict > 8192);
  assert.ok(opt.num_predict <= 65536);
});

test("ollama thinking off sends think false, leaves the user text alone", () => {
  const p = applyLlmOptions(
    { model: "qwen3-vl:30b-a3b-thinking-q8_0", messages: [{ role: "user", content: "hi" }] },
    { provider: "ollama", model: "qwen3-vl:30b-a3b-thinking-q8_0", api: "openai", context: 32768, thinking: "off" },
  );
  assert.equal(p.think, false);
  assert.equal("think" in (p.options as object), false);
  assert.equal("enable_thinking" in p, false);
  assert.equal(String((p.messages as { content: string }[])[0].content), "hi");
});

test("local temperature and n_ctx go on the wire", () => {
  const p = applyLlmOptions(
    { model: "llama3.1", messages: [{ role: "user", content: "hi" }] },
    { provider: "llamacpp", model: "llama3.1", api: "openai", context: 16384, thinking: "off", temperature: 0.7, maxOut: 1024 },
  );
  assert.equal(p.temperature, 0.7);
  assert.equal(p.n_ctx, 16384);
  const opt = p.options as { temperature: number; num_ctx: number; num_predict: number };
  assert.equal(opt.temperature, 0.7);
  assert.equal(opt.num_ctx, 16384);
  assert.equal(p.max_tokens, 1024);
});

test("local OpenAI thinking preserves a standard total output limit while Ollama keeps its native options", () => {
  for (const provider of ["custom", "llamacpp", "lmstudio", "vllm", "localai"]) {
    for (const thinking of ["auto", "off", "high"] as const) {
      const p = applyLlmOptions({}, { provider, model: "qwen3.8", context: 131072, thinking, maxOut: 4096 });
      assert.equal(p.max_tokens, 4096, `${provider}/${thinking}`);
      assert.equal(p.max_completion_tokens, undefined);
    }
  }
  const native = applyLlmOptions({}, { provider: "ollama", model: "qwen3.8", context: 131072, thinking: "high", maxOut: 4096 });
  assert.equal(native.max_tokens, undefined);
  assert.equal((native.options as {num_predict:number}).num_predict, 4096);
});

test("native llama.cpp uses its actual budget field without inventing chat-template effort support", () => {
  const make = (thinking: "off" | "auto" | "high") => applyLlmOptions({}, { provider: "llamacpp", model: "qwen3.8", thinking, context: 131072, maxOut: 4096 });
  const high = make("high");
  assert.equal(high.reasoning_budget_tokens, 4096);
  assert.equal(high.reasoning_budget, undefined);
  assert.equal(high.reasoning_effort, undefined);
  assert.equal(make("off").reasoning_budget_tokens, 0);
  assert.equal(make("off").enable_thinking, false);
  assert.equal(make("auto").reasoning_effort, undefined);
});
test("context fitting keeps native and wrapper reasoning budgets within the sent output limit", () => {
  for (const provider of ["custom", "llamacpp"]) {
    const runtime = { provider, model: "qwen3.8", thinking: "high" as const, context: 8192, maxOut: 16384 };
    const payload = applyLlmOptions({ messages: [{ role: "user", content: "Synthetic fitting fixture." }] }, runtime);
    prepChatPayload(payload, runtime.context);
    const max = Number(payload.max_tokens), budget = Number(payload.reasoning_budget_tokens ?? payload.reasoning_budget);
    assert.ok(max > 0 && max < 8192);
    assert.ok(budget <= max);
    assert.equal((payload.options as {num_predict:number}).num_predict, max);
    assert.equal(runtime.maxOut, 16384, "fitting must not rewrite the saved setting");
  }
  const disabled = { messages: [{role:"user",content:"Synthetic fixture."}], max_tokens: 512, reasoning_budget: 0, reasoning_budget_tokens: -1 };
  prepChatPayload(disabled, 8192);
  assert.equal(disabled.reasoning_budget, 0);
  assert.equal(disabled.reasoning_budget_tokens, -1);
});

test("qwen thinking on does not rewrite the prompt", () => {
  const p = applyLlmOptions(
    { model: "qwen3", messages: [{ role: "user", content: "hi" }] },
    { provider: "ollama", model: "qwen3:8b", api: "openai", context: 32768, thinking: "high" },
  );
  assert.equal("enable_thinking" in p, false);
  assert.equal(String((p.messages as { content: string }[])[0].content), "hi");
  assert.equal(p.think, "high");
});

test("ollama sends slider num_ctx, strips enable_thinking", () => {
  const p = applyLlmOptions(
    { model: "qwen3.8:27b" },
    { provider: "ollama", model: "qwen3.8:27b", api: "openai", context: 256000, thinking: "low" },
  );
  assert.equal((p.options as { num_ctx: number }).num_ctx, 256000);
  assert.equal("n_ctx" in p, false);
  assert.equal("enable_thinking" in p, false);
  assert.equal("chat_template_kwargs" in p, false);
});

test("cloud default max out stays modest even with 1M context", () => {
  assert.equal(clampMaxOut(undefined, 1_048_576, false), 8192);
  assert.equal(clampMaxOut(32000, 1_048_576, false), 32000);
  assert.ok(clampMaxOut(undefined, 131072, true) > 8192);
});

test("openai responses asks for a live reasoning summary", () => {
  const body = responsesBody(
    {
      model: "gpt-5.5",
      messages: [{ role: "user", content: "hi" }],
      reasoning_effort: "medium",
    },
    "openai",
  );
  assert.deepEqual(body.reasoning, { effort: "medium", summary: "auto" });
  const codex = responsesBody(
    {
      model: "gpt-5.6-luna",
      messages: [{ role: "user", content: "hi" }],
      reasoning_effort: "low",
    },
    "codex",
  );
  assert.deepEqual(codex.reasoning, { effort: "low" });
});

test("anthropic auto uses adaptive summarized thinking", () => {
  const p = applyLlmOptions(
    { model: "claude-opus-5" },
    { provider: "anthropic", model: "claude-opus-5", api: "anthropic", context: 1_000_000, thinking: "auto" },
  );
  assert.deepEqual(p.thinking, { type: "adaptive", display: "summarized" });
});

test("patchResponses400 drops nested reasoning.summary", () => {
  const body: Record<string, unknown> = { model: "gpt-5.5", reasoning: { effort: "medium", summary: "auto" } };
  assert.equal(patchResponses400(body, "Unsupported parameter: summary"), true);
  assert.deepEqual(body.reasoning, { effort: "medium" });
});


test("explicit local output is not capped to a percentage of context", () => {
  for (const thinking of ["off", "high"] as const) {
    const payload = applyLlmOptions({ stream: true }, { provider: "ollama", model: "qwen3", context: 32768, thinking, maxOut: 16384 });
    assert.equal((payload.options as { num_predict: number }).num_predict, 16384);
    assert.equal(payload.stream_options, undefined);
  }
});

test("DeepSeek represents absent prior reasoning explicitly without inventing or copying answer text", () => {
  const messages = [{ role: "assistant", content: "An earlier plain-text summary." }];
  const p = applyLlmOptions({ messages, tools: [] }, { provider: "deepseek", model: "deepseek-flash", context: 131072, thinking: "auto" });
  assert.equal((p.messages as Record<string, unknown>[])[0].reasoning_content, "");
  assert.equal((p.messages as Record<string, unknown>[])[0].content, messages[0].content);
  assert.equal(Object.hasOwn(messages[0], "reasoning_content"), false);
});

test("request streamed usage on OpenAI without changing Anthropic or legacy local wire formats", () => {
  for (const provider of ["openai", "anthropic", "custom"]) {
    const payload = applyLlmOptions({ stream: true }, { provider, model: "model", context: 32768, thinking: "off" });
    assert.deepEqual(payload.stream_options, provider === "openai" ? { include_usage: true } : undefined);
  }
});
