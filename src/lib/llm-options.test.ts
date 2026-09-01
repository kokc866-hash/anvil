import assert from "node:assert/strict";
import { test } from "node:test";
import { applyLlmOptions, needsCompletionTokens, usesResponsesApi } from "./llm-options.ts";

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
});

test("ollama thinking: no 8k cap, think level, no max_tokens", () => {
  const p = applyLlmOptions(
    { model: "qwen3.8:27b" },
    { provider: "ollama", model: "qwen3.8:27b", api: "openai", context: 131072, thinking: "high" },
  );
  const opt = p.options as { num_predict: number; think: unknown };
  assert.equal("max_tokens" in p, false);
  assert.equal(p.think, "high");
  assert.equal(opt.think, "high");
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
  assert.equal(p.enable_thinking, false);
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
  assert.equal(p.enable_thinking, true);
  assert.equal(String((p.messages as { content: string }[])[0].content), "hi");
  assert.equal(p.think, "high");
});
