import assert from "node:assert/strict";
import { test } from "node:test";
import { debugSkill, SKILL_CREATOR_BODY } from "./skill-debug.ts";

test("skill-creator body is valid", () => {
  const r = debugSkill({
    name: "skill-creator",
    when: "Skill schreiben Skill fixen Skill debuggen",
    body: SKILL_CREATOR_BODY,
  });
  assert.equal(r.ok, true, r.issues.join("; "));
});

test("empty prose skill fails debug", () => {
  const r = debugSkill({ name: "x", when: "hi", body: "einfach machen" });
  assert.equal(r.ok, false);
  assert.ok(r.issues.length >= 2);
});
