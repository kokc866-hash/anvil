import assert from "node:assert/strict";
import { test } from "node:test";
import { debugSkill, SKILL_CREATOR_BODY } from "./skill-debug.ts";
import { SEED } from "./skill-seeds.ts";

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

test("all seed skills pass debug and have unique ids", () => {
  assert.ok(SEED.length >= 20, `expected many seeds, got ${SEED.length}`);
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const s of SEED) {
    const r = debugSkill(s);
    assert.equal(r.ok, true, `${s.name}: ${r.issues.join("; ")}`);
    assert.equal(ids.has(s.id), false, `dup id ${s.id}`);
    assert.equal(names.has(s.name), false, `dup name ${s.name}`);
    ids.add(s.id);
    names.add(s.name);
  }
});

test("ref-halten points at ref/ not .anvil/ref", () => {
  const s = SEED.find((x) => x.id === "ref-halten" || x.name === "ref-halten");
  assert.ok(s);
  assert.match(s!.body, /list_files.*ref\//);
  assert.doesNotMatch(s!.body, /\.anvil\/ref/);
  assert.doesNotMatch(s!.when, /\.anvil\/ref/);
});

test("tests-schreiben does not claim a system pytest", () => {
  const s = SEED.find((x) => x.id === "tests" || x.name === "tests-schreiben");
  assert.ok(s);
  assert.match(s!.body, /Anvil führt die Testdateien/);
});
