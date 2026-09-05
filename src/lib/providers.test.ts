import assert from "node:assert/strict";
import { test } from "node:test";
import { isCodexExclusive, modelForProvider } from "./providers.ts";

test("luna/sol/terra are Codex-only", () => {
  assert.equal(isCodexExclusive("gpt-5.6-terra"), true);
  assert.equal(isCodexExclusive("gpt-5.6-luna"), true);
  assert.equal(isCodexExclusive("gpt-5.6-sol"), true);
  assert.equal(isCodexExclusive("gpt-5.5"), false);
});

test("openai remaps Codex ids to gpt-5.5", () => {
  assert.equal(modelForProvider("openai", "gpt-5.6-terra"), "gpt-5.5");
  assert.equal(modelForProvider("azure", "gpt-5.6-luna"), "gpt-5.5");
  assert.equal(modelForProvider("openai", "gpt-5.5"), "gpt-5.5");
});

test("codex keeps exclusive ids", () => {
  assert.equal(modelForProvider("codex", "gpt-5.6-terra"), "gpt-5.6-terra");
  assert.equal(modelForProvider("codex", "gpt-5.4"), "gpt-5.6-terra");
});
