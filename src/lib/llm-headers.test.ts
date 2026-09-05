import assert from "node:assert/strict";
import { test } from "node:test";
import { pipeHeaders, responsesNative } from "./llm-headers.ts";

test("responses native only openai and azure", () => {
  assert.equal(responsesNative("openai"), true);
  assert.equal(responsesNative("azure"), true);
  assert.equal(responsesNative("openrouter"), false);
  assert.equal(responsesNative("anthropic"), false);
  assert.equal(responsesNative("github"), false);
  assert.equal(responsesNative("xai"), false);
  assert.equal(responsesNative("google"), false);
  assert.equal(responsesNative("codex"), false);
});

test("pipe headers per provider", () => {
  const or = pipeHeaders("openrouter", "sk-or");
  assert.equal(or.Accept, "text/event-stream");
  assert.equal(or["HTTP-Referer"], "https://anvil.app");
  assert.equal(or["X-Title"], "Anvil");
  const g = pipeHeaders("google", "AIzaTEST");
  assert.equal(g["x-goog-api-key"], "AIzaTEST");
  const az = pipeHeaders("azure", "key");
  assert.equal(az["api-key"], "key");
  assert.equal("Authorization" in az, false);
});
