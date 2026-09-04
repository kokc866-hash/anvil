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

test("workspace id prefers repo then cwd then disk", () => {
  assert.equal(idFromPins({ workspaceCwd: "C:/Users/a/proj/anvil" }), "a/proj/anvil");
  assert.equal(idFromPins({ githubRepo: "kokc866-hash/anvil", workspaceCwd: "x" }), "kokc866-hash/anvil");
  assert.equal(idFromPins({ diskName: "Anvil" }), "Anvil");
  assert.equal(idFromPins({}), "local");
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
