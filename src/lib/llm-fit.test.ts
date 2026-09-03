import assert from "node:assert/strict";
import { test } from "node:test";
import { fitCloudAbo, isCloudOrAbo } from "./llm-fit.ts";

test("local and custom stay untouched", () => {
  assert.equal(isCloudOrAbo("ollama"), false);
  assert.equal(isCloudOrAbo("lmstudio"), false);
  assert.equal(isCloudOrAbo("custom"), false);
  assert.equal(isCloudOrAbo("grok"), false);
  assert.equal(fitCloudAbo("ollama", "qwen3.8:27b"), null);
});

test("cloud openai gets catalog context and auto", () => {
  const f = fitCloudAbo("openai", "gpt-4o")!;
  assert.equal(f.llmContextAuto, true);
  assert.equal(f.llmContext, 128_000);
  assert.equal(f.llmThinking, "auto");
  assert.equal(f.llmMaxOut, 0);
  assert.equal(f.llmTemperature, 0.3);
});

test("codex abo luna is 1M auto, no maxOut", () => {
  const f = fitCloudAbo("codex", "gpt-5.6-luna")!;
  assert.equal(f.llmContext, 1_048_576);
  assert.equal(f.llmThinking, "auto");
  assert.equal(f.llmMaxOut, 0);
  assert.equal(f.llmTemperature, 1);
});

test("anthropic abo/cloud", () => {
  const f = fitCloudAbo("anthropic", "claude-sonnet-4-5")!;
  assert.ok(f.llmContext >= 200_000);
  assert.equal(f.llmThinking, "auto");
  assert.equal(f.llmMaxOut, 0);
});
