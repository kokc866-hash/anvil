import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyCapToPayload,
  capLabel,
  classifyLlmError,
  getCap,
  resetCap,
  sendTools,
  setCap,
} from "./model-caps.ts";

test("gpt-5 seeds responsesApi", () => {
  resetCap("openai", "gpt-5.6");
  const c = getCap("openai", "gpt-5.6");
  assert.equal(c.responsesApi, true);
  resetCap("openrouter", "openai/gpt-5.5");
  assert.equal(getCap("openrouter", "openai/gpt-5.5").responsesApi, false);
  resetCap("xai", "grok-4.5");
  assert.equal(getCap("xai", "grok-4.5").responsesApi, false);
});

test("classify thinking+tools 400", () => {
  const p = classifyLlmError(
    400,
    `Function tools with reasoning_effort are not supported for gpt-5.6-sol`,
  );
  assert.equal(p?.noThinkWithTools, true);
});

test("classify missing type", () => {
  const p = classifyLlmError(400, "Missing tool call type");
  assert.ok(p);
});

test("applyCap strips think and tools-as-text", () => {
  const payload: Record<string, unknown> = {
    tools: [1],
    tool_choice: "required",
    think: true,
    reasoning_effort: "high",
    stream: true,
  };
  const still = applyCapToPayload(
    payload,
    {
      tools: "unknown",
      noThinkWithTools: true,
      noStreamTools: true,
      noRequired: true,
      responsesApi: false,
      note: "",
      at: 1,
    },
    true,
  );
  assert.equal(still, true);
  assert.equal(payload.think, undefined);
  assert.equal(payload.reasoning_effort, undefined);
  assert.equal(payload.stream, false);
  assert.equal(payload.tool_choice, "auto");
  assert.equal(sendTools({ ...getCap("x", "y"), tools: "text" }, true), false);
});

test("capLabel", () => {
  assert.equal(capLabel(getCap("none", "none")), "noch nichts gemerkt");
  setCap("ollama", "qwen", { noThinkWithTools: true, note: "Thinking bei Tools aus" });
  assert.match(capLabel(getCap("ollama", "qwen")), /Thinking/);
  resetCap("ollama", "qwen");
});
