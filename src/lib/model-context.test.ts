import assert from "node:assert/strict";
import { test } from "node:test";
import {
  lookupKnown,
  rememberContext,
  ingestModelRow,
  anvilContext,
  wantsAutoContext,
  modelMatchesId,
} from "./model-context.ts";

test("matches openai gpt-4o and claude", () => {
  assert.equal(lookupKnown("gpt-4o")?.n, 128000);
  assert.equal(lookupKnown("openai/gpt-4o-mini")?.n, 128000);
  assert.ok((lookupKnown("claude-sonnet-4-20250514")?.n ?? 0) >= 200000);
});

test("api row caches context_length, ignores max_tokens output cap", () => {
  ingestModelRow({ id: "vendor/special-9b", context_length: 65536, max_tokens: 4096 });
  assert.equal(lookupKnown("vendor/special-9b")?.n, 65536);
  assert.equal(lookupKnown("special-9b")?.source, "api");
  ingestModelRow({ id: "only-output-cap", max_tokens: 128000 });
  assert.equal(lookupKnown("only-output-cap"), null);
});

test("gpt-5.6 luna is 1M, not the gpt-5 256k row", () => {
  assert.equal(lookupKnown("gpt-5.6-luna")?.n, 1_048_576);
  assert.equal(lookupKnown("gpt-5.6-terra")?.n, 1_048_576);
  assert.equal(lookupKnown("gpt-5.6-sol")?.n, 1_048_576);
  assert.equal(lookupKnown("gpt-5")?.n, 256_000);
});

test("gpt-6-astra and gpt-5.5-pro are 1M, not gpt-5 256k", () => {
  assert.equal(false, modelMatchesId("gpt-5.5-pro-2026-04-23", "gpt-5"));
  assert.equal(true, modelMatchesId("gpt-5.5-pro-2026-04-23", "gpt-5.5"));
  assert.equal(lookupKnown("gpt-6-astra")?.n, 1_050_000);
  assert.equal(lookupKnown("gpt-5.5-pro-2026-04-23")?.n, 1_048_576);
  assert.equal(lookupKnown("openai/gpt-6-astra")?.n, 1_050_000);
});

test("other clouds: claude fable, grok 4.5, gemini 3", () => {
  assert.equal(lookupKnown("claude-fable-5.1")?.n, 1_000_000);
  assert.equal(lookupKnown("claude-opus-5")?.n, 1_000_000);
  assert.equal(lookupKnown("grok-4.5")?.n, 500_000);
  assert.equal(lookupKnown("gemini-3.8-flash")?.n, 1_048_576);
});

test("anvil keeps 1M, clamps only above 2M", () => {
  assert.equal(anvilContext(1_048_576), 1_048_576);
  assert.equal(anvilContext(1_047_576), 1_047_576);
  assert.equal(anvilContext(4_000_000), 2_097_152);
});

test("cloud yes, ollama no", () => {
  assert.equal(wantsAutoContext("openai"), true);
  assert.equal(wantsAutoContext("codex"), true);
  assert.equal(wantsAutoContext("anthropic"), true);
  assert.equal(wantsAutoContext("google"), true);
  assert.equal(wantsAutoContext("openrouter"), true);
  assert.equal(wantsAutoContext("xai"), true);
  assert.equal(wantsAutoContext("custom"), false);
  assert.equal(wantsAutoContext("grok"), true);
  assert.equal(wantsAutoContext("ollama"), false);
});

test("remember rejects junk", () => {
  assert.equal(rememberContext("x", 12, "api"), null);
});
