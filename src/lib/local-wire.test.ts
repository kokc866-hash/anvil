import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { localChatUrl, sanitizeLocalPayload, usesOllamaNative, ollamaRoot, localWireNote, rewriteOllamaChat, ndjsonLineToSse } from "./local-wire.ts";

describe("local-wire", () => {
  it("ollama talks native /api/chat, not OpenAI /v1", () => {
    assert.equal(usesOllamaNative("ollama", "http://192.168.178.41:11434"), true);
    assert.equal(ollamaRoot("http://192.168.178.41:11434/v1"), "http://192.168.178.41:11434");
    assert.equal(
      localChatUrl("ollama", "http://192.168.178.41:11434/v1"),
      "http://192.168.178.41:11434/api/chat",
    );
    assert.equal(localChatUrl("lmstudio", "http://127.0.0.1:1234/v1"), "http://127.0.0.1:1234/v1/chat/completions");
    assert.equal(usesOllamaNative("openai", "https://api.openai.com"), false);
  });

  it("drops Responses/Cloud fields and never sends empty messages", () => {
    const p = sanitizeLocalPayload(
      "ollama",
      {
        model: "qwen3.8:27b-mtp-q8_0",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
        think: "low",
        tools: [{ type: "function", function: { name: "read_file" } }],
        tool_choice: "required",
        input: [],
        reasoning: { effort: "low" },
        max_output_tokens: 99,
        options: { num_ctx: 131072, num_predict: 2048, think: "low", foo: 1 },
        keep_alive: "30m",
      },
      true,
    );
    assert.equal("input" in p, false);
    assert.equal("reasoning" in p, false);
    assert.equal("max_output_tokens" in p, false);
    assert.equal(p.think, "low");
    assert.equal("tool_choice" in p, false);
    assert.equal("foo" in (p.options as object), false);
  });

  it("wire note is short and has the numbers", () => {
    const n = localWireNote("http://x/api/chat", {
      model: "qwen",
      stream: true,
      think: false,
      messages: [{ role: "user", content: "a" }],
      tools: [1, 2],
      options: { num_ctx: 4096 },
    });
    assert.match(n, /\/api\/chat/);
    assert.match(n, /tools=2/);
    assert.match(n, /think=false/);
  });
});

describe("ollama rewrite", () => {
  it("keeps /v1/chat/completions and keeps think with tools", () => {
    const r = rewriteOllamaChat("http://192.168.178.41:11434/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "qwen",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
        think: "low",
        tools: [{ type: "function", function: { name: "read_file" } }],
        input: [],
      }),
    });
    assert.equal(r.url, "http://192.168.178.41:11434/v1/chat/completions");
    const body = JSON.parse(String(r.init.body));
    assert.equal(body.think, "low");
    assert.equal("input" in body, false);
  });

  it("does not touch OpenAI cloud", () => {
    const r = rewriteOllamaChat("https://api.openai.com/v1/chat/completions", {
      body: JSON.stringify({ model: "gpt", messages: [] }),
    });
    assert.equal(r.url, "https://api.openai.com/v1/chat/completions");
  });

  it("ndjson becomes SSE the existing reader understands", () => {
    const sse = ndjsonLineToSse('{"message":{"content":"Hi","thinking":"hmm"},"done":false}');
    assert.match(sse, /^data: /);
    const j = JSON.parse(sse.slice(5).trim());
    assert.equal(j.choices[0].delta.content, "Hi");
    assert.equal(j.choices[0].delta.reasoning, "hmm");
    assert.equal(ndjsonLineToSse('{"done":true}'), "data: [DONE]\n\n");
  });
});
