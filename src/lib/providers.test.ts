import assert from "node:assert/strict";
import { test } from "node:test";
import { modelForProvider, connectionMode, connectionSlot, connectionDefaults, modelsForConnection, providerOf, PROVIDER_GROUPS } from "./providers.ts";

test("Qwen and DeepSeek use API discovery with no hard-coded model picker or forced replacement", () => {
  for (const id of ["qwen", "deepseek"]) {
    const spec = providerOf(id);
    assert.equal(spec.id, id);
    assert.equal(spec.needsKey, true);
    assert.equal(spec.api, "openai");
    assert.equal(spec.model, "", "new connections choose a model after discovery");
    assert.deepEqual(modelsForConnection(id), []);
    assert.equal(connectionMode(id, "abo"), "key");
    assert.ok(PROVIDER_GROUPS.find(g => g.id === "cloud")?.ids.includes(spec.id));
    assert.equal(modelForProvider(id, "my-saved-or-future-model"), "my-saved-or-future-model");
  }
  assert.equal(providerOf("qwen").needsUrl, true);
});

test("Claude CLI has current-family aliases while API suggestions keep exact IDs", () => {
  for (const alias of ["sonnet", "opus", "haiku", "fable"]) {
    assert.ok(modelsForConnection("anthropic", "abo").includes(alias));
    assert.ok(!modelsForConnection("anthropic", "key").includes(alias));
  }
});

test("Claude and Copilot catalog suggestions include current generations", () => {
  for (const model of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"])
    assert.ok(providerOf("anthropic").models.includes(model), `${model} missing for Claude`);
  for (const model of ["gpt-6.1-sol", "claude-sonnet-5.5", "claude-opus-5.5", "gemini-3.8-flash"])
    assert.ok(providerOf("github").models.includes(model), `${model} missing for Copilot`);
  assert.equal(modelForProvider("anthropic", "claude-sonnet-4-5"), "claude-sonnet-4-5");
  assert.equal(modelForProvider("github", "gpt-4.1"), "gpt-4.1");
});

test("the ChatGPT subscription catalog includes the current Codex generation without changing the selected model", () => {
  const catalog = providerOf("codex").models;
  for (const model of ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna"]) {
    assert.ok(catalog.includes(model), `${model} is missing from the ChatGPT subscription picker`);
  }
  assert.equal(modelForProvider("codex", "gpt-5.6-terra"), "gpt-5.6-terra");
});

test("selected models and Azure deployments are never silently remapped", () => {
  for (const provider of ["codex", "openai", "azure", "custom"]) {
    for (const model of ["gpt-5.4", "gpt-5.6-terra", "my-deployment", "future-model"]) assert.equal(modelForProvider(provider, model), model);
  }
});
test("subscription is explicit, Codex always uses CLI, API and CLI slots are distinct", () => {
  assert.equal(connectionMode("codex", "key"), "abo");
  assert.equal(connectionMode("anthropic"), "key");
  assert.equal(connectionMode("anthropic", "abo"), "abo");
  assert.equal(connectionMode("custom", "abo"), "key");
  assert.equal(connectionMode("huggingface", "abo"), "key");
  assert.notEqual(connectionSlot("anthropic", "abo"), connectionSlot("anthropic", "key"));
  assert.equal(connectionMode("github", "key"), "abo");
  assert.equal(connectionDefaults("github", "key").baseUrl, "");
  assert.equal(connectionDefaults("github", "abo").baseUrl, "");
});
