import assert from "node:assert/strict";
import { test } from "node:test";
import { persistedChatQueue, queuedChatRequest, queuedReplyMatches } from "./chat-queue.ts";

test("queue round-trip preserves each task's mode, including mixed queues", () => {
  const queue = [{ text: "Explain", mode: "ask" }, { text: "Edit", mode: "agent" }];
  assert.deepEqual(persistedChatQueue(JSON.parse(JSON.stringify(queue))), queue);
});
test("parked replies preserve their exact project, job and question through persistence", () => {
  const reply = { jobId: "job-1", askId: "ask-1", project: "project-a" };
  const request = { text: "Antwort auf: Which fixture?\nWahl: A) Clock", mode: "agent" as const, reply };
  assert.deepEqual(persistedChatQueue([request]), [request]);
  const completeAnswer = { ...request, text: "Antwort auf: Which fixture?\nWahl: A) Clock\n" + "x".repeat(2000) };
  assert.equal(persistedChatQueue([completeAnswer])[0].text, completeAnswer.text, "The user's answer is never silently truncated");
  const job = { id: "job-1", status: "ask", ask: { id: "ask-1" } };
  assert.equal(queuedReplyMatches(request, job, "project-a"), true);
  assert.equal(queuedReplyMatches(request, job, "project-b"), false);
  assert.equal(queuedReplyMatches(request, { ...job, id: "job-2" }, "project-a"), false);
  assert.equal(queuedReplyMatches(request, { ...job, ask: { id: "ask-2" } }, "project-a"), false);
  assert.equal(queuedReplyMatches(request, { ...job, status: "run" }, "project-a"), false);
  assert.equal(queuedChatRequest({ ...request, reply: { ...reply, askId: "" } }), null);
});
test("legacy and damaged queue entries never become editing tasks by default", () => {
  assert.deepEqual(persistedChatQueue(["Old request", null, {}, { text: "Unknown mode", mode: "other" }, "  "]), [
    { text: "Old request", mode: "ask" }, { text: "Unknown mode", mode: "ask" },
  ]);
  assert.equal(queuedChatRequest([]), null);
  assert.equal(persistedChatQueue(Array(12).fill("Question")).length, 8);
});
