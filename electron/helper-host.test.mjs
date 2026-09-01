import assert from "node:assert/strict";
import { test } from "node:test";
import { diskRel, hfSource } from "./hf-get.mjs";

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
