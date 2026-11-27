import assert from "node:assert/strict";
import { test } from "node:test";
import { ReasoningGuard, ReasoningChannel, ReasoningRepetitionError, guardReasoningChoice } from "./reasoning-guard.ts";

const block = Array.from({ length: 60 }, (_, n) => `Observation ${n}: independent proof ${n * 17} and next action ${n * n}.\n`).join("").slice(0, 1919);
function feed(guard: ReasoningGuard, text: string, size: number): void {
  for (let i = 0; i < text.length; i += size) guard.push(text.slice(i, i + size));
}
for (const size of [1, 7, 127, 256, 65536]) test(`original-length repeated blocks stop across chunks of ${size}`, () => {
  assert.throws(() => feed(new ReasoningGuard(), block.repeat(8), size), error => error instanceof ReasoningRepetitionError && error.code === "reasoning_repetition");
});
test("four full blocks and short repeated headings do not establish a loop", () => {
  new ReasoningGuard().push(block.repeat(4));
  new ReasoningGuard().push(Array.from({ length: 500 }, (_, n) => `Check:\nObservation ${n}: result ${n * 19}.\n`).join(""));
});
test("the final partial check interval is checked when a reasoning phase ends", () => {
  const guard = new ReasoningGuard(); guard.push(block.repeat(5));
  assert.throws(() => guard.finish(), ReasoningRepetitionError);
  const channel = new ReasoningChannel(() => {}, () => {}); channel.thought(block.repeat(5));
  assert.throws(() => channel.visible("Final answer"), ReasoningRepetitionError);
});
test("sustained short-period degeneration is detected only after a substantial span", () => {
  const guard = new ReasoningGuard();
  guard.push("abc ".repeat(100));
  assert.throws(() => guard.push("abc ".repeat(1200)), ReasoningRepetitionError);
});
test("a long advancing history stays bounded without truncating caller output", () => {
  const guard = new ReasoningGuard();
  for (let n = 0; n < 8000; n++) guard.push(`Distinct observation ${n}: tested value ${n * n}; next case ${n + 1}.\n`);
  assert.ok(guard.bufferedCharacters <= 65536);
});
test("an unchanged long prefix is detected even when a large chunk ends in new text", () => {
  assert.throws(() => new ReasoningGuard().push(block.repeat(8) + "A new suffix".repeat(3)), ReasoningRepetitionError);
});
test("reset separates distinct reasoning phases", () => {
  const guard = new ReasoningGuard();
  guard.push(block.repeat(3)); guard.clear(); guard.push(block.repeat(3));
});
test("split inline tags keep complete Unicode text and do not leak markup", () => {
  let text = "", thought = "";
  const channel = new ReasoningChannel(s => { text += s; }, s => { thought += s; });
  for (const part of ["Before<thi", "nk>🐣 Über", "prüfung</thi", "nk>After <", "= 7"]) channel.content(part);
  channel.finish();
  assert.equal(thought, "🐣 Überprüfung");
  assert.equal(text, "BeforeAfter <= 7");
  assert.equal(channel.inThinking, false);
});
test("visible repeated answers are not checked as reasoning", () => {
  let text = "";
  const channel = new ReasoningChannel(s => { text += s; }, () => {});
  channel.content(block.repeat(8)); channel.finish();
  assert.equal(text, block.repeat(8));
});
test("new visible work separates reasoning phases while whitespace alone does not", () => {
  const channel = new ReasoningChannel(() => {}, () => {});
  channel.thought(block.repeat(3)); channel.visible("A real intermediate answer."); channel.thought(block.repeat(3));
  const unchanged = new ReasoningChannel(() => {}, () => {});
  unchanged.thought(block.repeat(3)); unchanged.visible(" \n ");
  assert.throws(() => unchanged.thought(block.repeat(3)), ReasoningRepetitionError);
});
test("non-streaming completions reject reasoning loops but preserve repeated answer and tool data", () => {
  assert.throws(() => guardReasoningChoice({ content: "", reasoning_content: block.repeat(8) }), ReasoningRepetitionError);
  assert.throws(() => guardReasoningChoice({ content: `<think>${block.repeat(8)}</think>Answer` }), ReasoningRepetitionError);
  const content = block.repeat(8), tool_calls = [{ arguments: content }];
  const original = { content, tool_calls };
  assert.deepEqual(guardReasoningChoice(original), { ...original, reasoning: undefined });
  assert.equal(original.content, content);
  assert.deepEqual(guardReasoningChoice({ content: "<think>One new thought.</think>Answer" }), { content: "Answer", reasoning: "One new thought." });
});
