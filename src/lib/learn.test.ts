import assert from "node:assert/strict";
import { test } from "node:test";
import { factsFromUtterance, idFromPins, parseSkillMd } from "./learn-parse.ts";

test("kein Ahnung is not a ban", () => {
  const facts = factsFromUtterance("keine Ahnung, das ist falsch");
  assert.equal(facts.some((f) => /Ahnung/i.test(f.text)), false);
});

test("kein Bock is not a ban", () => {
  const facts = factsFromUtterance("kein Bock auf das Thema");
  assert.equal(facts.some((f) => /Bock|Thema/i.test(f.text)), false);
});

test("nicht so does not mint a fact", () => {
  const facts = factsFromUtterance("nicht so, das ist falsch");
  assert.equal(facts.length, 0);
});

test("immer pytest is a project fact", () => {
  const facts = factsFromUtterance("immer pytest für Tests.");
  assert.ok(facts.some((f) => f.kind === "project" && /pytest/i.test(f.text)));
});

test("workspace identity uses complete paths and stable portable IDs", () => {
  assert.equal(idFromPins({ workspaceCwd: "C:/Users/a/proj/anvil" }), "v2:path:c:/users/a/proj/anvil");
  assert.notEqual(idFromPins({ workspaceCwd: "C:/one/shared/apps/game" }), idFromPins({ workspaceCwd: "D:/two/shared/apps/game" }));
  assert.equal(idFromPins({ githubRepo: "kokc866-hash/anvil", workspaceCwd: "x" }), "v2:path:x");
  assert.equal(idFromPins({ githubRepo: "https://github.com/Owner/Repo.git" }), "v2:repo:owner/repo");
  assert.notEqual(idFromPins({ diskName: "Same", workspaceMemoryId: "one" }), idFromPins({ diskName: "Same", workspaceMemoryId: "two" }));
});

test("questions and negations cannot invert preferences", () => {
  const facts = factsFromUtterance("Warum gibt es keine Animation? Bitte kein pytest, sondern unittest.");
  assert.equal(facts.some(f => /Animation|Python-Tests mit pytest/.test(f.text)), false);
  assert.ok(facts.some(f => f.text === "Nicht verwenden: pytest"));
  assert.equal(factsFromUtterance("Statt TypeScript lieber Python.").some(f => /Bevorzugt TypeScript/.test(f.text)), false);
  assert.equal(factsFromUtterance("Bitte nicht kurz antworten.").some(f => /Antworten kurz/.test(f.text)), false);
});

test("skill files default to project and preserve full instructions", () => {
  const skill = parseSkillMd("A".repeat(9000), ".anvil/skills/build-unique.md");
  assert.ok(skill);
  assert.equal(skill.scope, "project");
  assert.equal(skill.id, "build-unique");
  assert.equal(skill.body.length, 9000);
});

test("standard folder skills use description and distinct stable folder identities", () => {
  const source = '---\nname: "web-check"\ndescription: >-\n  Check a page\n  after changes.\nlicense: MIT\n---\nRead references/check.md before testing.';
  const one = parseSkillMd(source, ".anvil/skills/one/SKILL.md");
  const two = parseSkillMd(source, ".anvil/skills/two/SKILL.md");
  assert.equal(one?.when, "Check a page after changes.");
  assert.equal(one?.name, "web-check");
  assert.notEqual(one?.id, two?.id);
  assert.equal(one?.id, parseSkillMd(source, ".anvil/skills/one/SKILL.md")?.id);
});

test("parses skill markdown", () => {
  const s = parseSkillMd(
    "---\nname: git-gruen\nwhen: commit git\nkind: guide\nscope: user\n---\n1. run_file\n2. git_status\n",
    ".anvil/skills/git-gruen.md",
  );
  assert.equal(s?.name, "git-gruen");
  assert.match(s?.body ?? "", /git_status/);
});

test("rejects tiny skill bodies", () => {
  assert.equal(parseSkillMd("---\nname: x\n---\nshort", ".anvil/skills/x.md"), null);
});
