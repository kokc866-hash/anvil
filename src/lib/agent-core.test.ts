import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { asToolCall, stampToolCalls } from "./tool-call.ts";

describe("system prompt", () => {
  const src = readFileSync(new URL("./agent-core.ts", import.meta.url), "utf8");
  const body = src.match(/export const AGENT_SYSTEM = `([\s\S]*?)`;/)?.[1] ?? "";
  it("has no tool-template placeholders", () => {
    assert.equal(/<tool_call>|<function-name>|args-json-object/i.test(body), false);
  });
  it("leads with tools-not-prose and stays short", () => {
    assert.match(body, /tools/i);
    assert.match(body, /set_plan/);
    assert.doesNotMatch(body, /Du bist/);
    assert.ok(body.length > 400 && body.length < 2800, String(body.length));
  });
});

describe("tool_calls OpenAI type", () => {
  it("asToolCall sets type function", () => {
    const t = asToolCall("mF6", "set_plan", "{\"steps\":[]}");
    assert.equal(t.type, "function");
    assert.equal(t.id, "mF6");
    assert.equal(t.function.name, "set_plan");
  });
  it("stampToolCalls fills missing type", () => {
    const out = stampToolCalls([
      {
        role: "assistant",
        tool_calls: [{ id: "mF6HEQSEQO2uI3xEw7dCcoDjEehyHNtP", function: { name: "set_plan", arguments: "{\"steps\":[]}" } }],
      },
    ]);
    const tc = (out[0].tool_calls as { type: string; id: string }[])[0];
    assert.equal(tc.type, "function");
    assert.equal(tc.id, "mF6HEQSEQO2uI3xEw7dCcoDjEehyHNtP");
  });
});
