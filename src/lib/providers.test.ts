import assert from "node:assert/strict";
import { test } from "node:test";
import { modelForProvider, connectionMode, connectionSlot, connectionDefaults } from "./providers.ts";

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
