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
  it("keeps planning, file safety and proof requirements within a bounded prompt", () => {
    assert.match(body, /tools/i);
    assert.match(body, /set_plan/);
    assert.match(body, /ask_user/);
    assert.doesNotMatch(body, /Du bist/);
    assert.match(body, /read_file/);
    assert.match(body, /Compile then Run/);
    assert.match(body, /Successful execution alone does not prove/);
    assert.match(body, /(?:confirmed|proof|evidence|verified)/i);
    // The original 2.8k limit predates run, verification and knowledge contracts.
    // Keep a 5.2k ceiling (roughly 1.3k tokens at characters/4) so growth is reviewed.
    assert.ok(body.length > 400 && body.length < 5200, String(body.length));
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
