import assert from "node:assert/strict";
import { test } from "node:test";
import { foldChatMessages } from "./chat-roles.ts";

test("merges leading systems into one", () => {
  const out = foldChatMessages([
    { role: "system", content: "A" },
    { role: "system", content: "B" },
    { role: "user", content: "hi" },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].role, "system");
  assert.equal(out[0].content, "A\n\nB");
  assert.equal(out[1].role, "user");
});

test("later system becomes user", () => {
  const out = foldChatMessages([
    { role: "system", content: "A" },
    { role: "user", content: "hi" },
    { role: "assistant", content: "ok" },
    { role: "system", content: "Hinweis" },
    { role: "user", content: "weiter" },
  ]);
  assert.equal(out.filter((m) => m.role === "system").length, 1);
  assert.equal(out[0].role, "system");
  assert.equal(out[3].role, "user");
  assert.equal(out[3].content, "Hinweis");
});

test("developer folds into system when first", () => {
  const out = foldChatMessages([
    { role: "developer", content: "dev" },
    { role: "user", content: "x" },
  ]);
  assert.equal(out[0].role, "system");
  assert.equal(out[0].content, "dev");
});
