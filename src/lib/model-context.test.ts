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

test("gpt-5.6 luna is 1M, not the gpt-5 256k row", () => {
  assert.equal(lookupKnown("gpt-5.6-luna")?.n, 1_048_576);
  assert.equal(lookupKnown("gpt-5.6-terra")?.n, 1_048_576);
  assert.equal(lookupKnown("gpt-5.6-sol")?.n, 1_048_576);
  assert.equal(lookupKnown("gpt-5")?.n, 256_000);
});

test("anvil keeps 1M, clamps only above 2M", () => {
  assert.equal(anvilContext(1_048_576), 1_048_576);
  assert.equal(anvilContext(1_047_576), 1_047_576);
  assert.equal(anvilContext(4_000_000), 2_097_152);
});

test("cloud yes, ollama no", () => {
  assert.equal(wantsAutoContext("openai"), true);
  assert.equal(wantsAutoContext("codex"), true);
  assert.equal(wantsAutoContext("grok"), true);
  assert.equal(wantsAutoContext("ollama"), false);
});

test("remember rejects junk", () => {
  assert.equal(rememberContext("x", 12, "api"), null);
});
