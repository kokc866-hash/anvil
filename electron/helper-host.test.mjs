import assert from "node:assert/strict";
import { test } from "node:test";
import { diskRel, hfSource, helperModelId, parseHelperPath, MAX_REDIRECTS, MAX_JSON, MAX_FILE } from "./hf-get.mjs";
import { allowCorsOrigin } from "../companion/guard.mjs";

test("WebLLM resolve/main maps to id/file on disk", () => {
  assert.equal(
    diskRel("Qwen3.5-0.8B-q4f16_1-MLC/resolve/main/mlc-chat-config.json"),
    "Qwen3.5-0.8B-q4f16_1-MLC/mlc-chat-config.json",
  );
  assert.equal(
    diskRel("Qwen3.5-0.8B-q4f16_1-MLC/mlc-chat-config.json"),
    "Qwen3.5-0.8B-q4f16_1-MLC/mlc-chat-config.json",
  );
  assert.equal(diskRel("libs/foo.wasm"), "libs/foo.wasm");
});

test("HF URL is not doubled resolve/main", () => {
  const u = hfSource("Qwen3.5-0.8B-q4f16_1-MLC/resolve/main/mlc-chat-config.json");
  assert.equal(u, "https://huggingface.co/mlc-ai/Qwen3.5-0.8B-q4f16_1-MLC/resolve/main/mlc-chat-config.json");
  assert.equal(u.includes("resolve/main/resolve"), false);
});

test("helperModelId rejects traversal", () => {
  assert.equal(helperModelId("Qwen2.5-0.5B-Instruct-q4f16_1-MLC"), "Qwen2.5-0.5B-Instruct-q4f16_1-MLC");
  assert.throws(() => helperModelId(".."));
  assert.throws(() => helperModelId("../secrets"));
  assert.throws(() => helperModelId("libs"));
  assert.throws(() => helperModelId("a/b"));
});

test("parseHelperPath requires token prefix", () => {
  const tok = "abc123";
  assert.equal(parseHelperPath("/t/abc123/Qwen/x.json", tok).ok, true);
  assert.equal(parseHelperPath("/t/abc123/Qwen/x.json", tok).rest, "Qwen/x.json");
  assert.equal(parseHelperPath("/t/nope/Qwen/x.json", tok).ok, false);
  assert.equal(parseHelperPath("/Qwen/x.json", tok).ok, false);
});

test("helper host cors is loopback only", () => {
  assert.equal(allowCorsOrigin("http://127.0.0.1:8080"), "http://127.0.0.1:8080");
  assert.equal(allowCorsOrigin("https://evil.example"), "");
});

test("download caps exist", () => {
  assert.ok(MAX_REDIRECTS <= 5);
  assert.ok(MAX_JSON <= 8_000_000);
  assert.ok(MAX_FILE <= 2_400_000_000);
});
