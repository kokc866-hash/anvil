import assert from "node:assert/strict";
import { test } from "node:test";
import { applyLlmOptions, applyResponsesStore, clampMaxOut, needsCompletionTokens, patchResponses400, responsesBody, toResponsesInput, usesResponsesApi } from "./llm-options.ts";

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

test("gpt-5 thinking off omits reasoning_effort", () => {
  const p = applyLlmOptions(
    { model: "gpt-5.6-sol" },
    { provider: "openai", model: "gpt-5.6-sol", api: "openai", context: 32768, thinking: "off" },
    { tools: true },
  );
  assert.equal("reasoning_effort" in p, false);
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
  const opt = p.options as { num_predict: number; think: unknown; num_ctx: number };
  assert.equal("max_tokens" in p, false);
  assert.equal(p.think, "high");
  assert.equal(opt.think, "high");
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
  assert.equal((p.options as { think: boolean }).think, false);
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
