import assert from "node:assert/strict";
import { test } from "node:test";
import { formatContext, formatTokens, matchingContextChip } from "./tokens.ts";

test("128k chip is 128000, old 131072 snaps", () => {
  assert.equal(matchingContextChip(128_000), 128_000);
  assert.equal(matchingContextChip(131_072), 128_000);
  assert.equal(matchingContextChip(262_144), 256_000);
  assert.equal(formatContext(131_072), "128k");
  assert.equal(formatContext(128_000), "128k");
  assert.equal(formatContext(32768), "32k");
});

test("formatTokens stays decimal for usage counts", () => {
  assert.equal(formatTokens(131072), "131k");
  assert.equal(formatTokens(128000), "128k");
});
