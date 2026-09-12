import assert from "node:assert/strict";
import { test } from "node:test";
import { persistedChatQueue, queuedChatRequest } from "./chat-queue.ts";

test("queue round-trip preserves each task's mode, including mixed queues", () => {
  const queue = [{ text: "Explain", mode: "ask" }, { text: "Edit", mode: "agent" }];
  assert.deepEqual(persistedChatQueue(JSON.parse(JSON.stringify(queue))), queue);
});
test("legacy and damaged queue entries never become editing tasks by default", () => {
  assert.deepEqual(persistedChatQueue(["Old request", null, {}, { text: "Unknown mode", mode: "other" }, "  "]), [
    { text: "Old request", mode: "ask" }, { text: "Unknown mode", mode: "ask" },
  ]);
  assert.equal(queuedChatRequest([]), null);
  assert.equal(persistedChatQueue(Array(12).fill("Question")).length, 8);
});
