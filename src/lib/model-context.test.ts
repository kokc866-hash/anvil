import assert from "node:assert/strict";
import { test } from "node:test";
import { lookupKnown, rememberContext, ingestModelRow, anvilContext, wantsAutoContext } from "./model-context.ts";

test("matches openai gpt-4o and claude", () => {
  assert.equal(lookupKnown("gpt-4o")?.n, 128000);
  assert.equal(lookupKnown("openai/gpt-4o-mini")?.n, 128000);
  assert.ok((lookupKnown("claude-sonnet-4-20250514")?.n ?? 0) >= 200000);
});

test("api row caches context_length", () => {
  ingestModelRow({ id: "vendor/special-9b", context_length: 65536 });
  assert.equal(lookupKnown("vendor/special-9b")?.n, 65536);
  assert.equal(lookupKnown("special-9b")?.source, "api");
});

test("anvil clamps 1M to 256k", () => {
  assert.equal(anvilContext(1_048_576), 262144);
});

test("cloud yes, ollama no", () => {
  assert.equal(wantsAutoContext("openai"), true);
  assert.equal(wantsAutoContext("grok"), true);
  assert.equal(wantsAutoContext("ollama"), false);
});

test("remember rejects junk", () => {
  assert.equal(rememberContext("x", 12, "api"), null);
});
