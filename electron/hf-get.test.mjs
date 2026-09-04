import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchJsonText, hfAllowed, jsonAlts, helperModelId, parseHelperPath, MAX_REDIRECTS } from "./hf-get.mjs";

test("hfAllowed hosts", () => {
  assert.equal(hfAllowed("https://huggingface.co/mlc-ai/x"), true);
  assert.equal(hfAllowed("https://cdn-lfs.huggingface.co/x"), true);
  assert.equal(hfAllowed("https://cas-bridge.xethub.hf.co/x"), true);
  assert.equal(hfAllowed("https://hf-mirror.com/mlc-ai/x"), true);
  assert.equal(hfAllowed("https://raw.githubusercontent.com/mlc-ai/x"), true);
  assert.equal(hfAllowed("https://github.com/mlc-ai/x"), true);
  assert.equal(hfAllowed("http://huggingface.co/x"), false);
  assert.equal(hfAllowed("https://evil.example/x"), false);
});

test("jsonAlts adds mirror and raw", () => {
  const u = "https://huggingface.co/mlc-ai/Qwen3.5-0.8B-q4f16_1-MLC/resolve/main/mlc-chat-config.json";
  const a = jsonAlts(u);
  assert.ok(a.includes(u));
  assert.ok(a.some((x) => x.includes("hf-mirror.com")));
  assert.ok(a.some((x) => x.includes("/raw/main/")));
});

test("fetchJsonText follows HF 307", async () => {
  const text = await fetchJsonText(
    "https://huggingface.co/mlc-ai/Qwen3.5-0.8B-q4f16_1-MLC/resolve/main/mlc-chat-config.json",
  );
  const j = JSON.parse(text);
  assert.equal(j.model_type, "qwen3_5");
});

test("helper ids and token path", () => {
  assert.equal(helperModelId("SmolLM2-360M-Instruct-q4f16_1-MLC"), "SmolLM2-360M-Instruct-q4f16_1-MLC");
  assert.throws(() => helperModelId("..\\x"));
  assert.equal(parseHelperPath("/t/tok/id/file.bin", "tok").ok, true);
  assert.equal(MAX_REDIRECTS, 5);
});
