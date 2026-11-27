import assert from "node:assert/strict";
import test from "node:test";
import { ruleContext, ruleFilesPresent, workspaceRules, RULE_LIMITS } from "./rules.ts";

const mdc = (header: string, body: string) => `---\n${header}\n---\n${body}`;

test("target paths select ancestors without leaking sibling project instructions", () => {
  const files = { "AGENTS.md": "ROOT", "web/AGENTS.md": "WEB ONLY", "web/.anvil/rules.md": "WEB ANVIL", "api/AGENTS.md": "API ONLY", "web/src/main.ts": "", "api/main.ts": "" };
  const result = workspaceRules(files, "", ["web/src/main.ts"]);
  assert.match(result, /ROOT/);
  assert.match(result, /WEB ONLY/);
  assert.match(result, /WEB ANVIL/);
  assert.doesNotMatch(result, /API ONLY/);
  assert.deepEqual(ruleFilesPresent(files, ["web/src/main.ts"]), ["AGENTS.md", "web/AGENTS.md", "web/.anvil/rules.md"]);
});

test("the existing two-argument entry point keeps only global root rules", () => {
  const files = { ".anvil/rules.md": "GLOBAL ANVIL", "AGENTS.md": "GLOBAL AGENTS", ".cursorrules": "GLOBAL LEGACY", "CLAUDE.md": "GLOBAL CLAUDE", "sub/AGENTS.md": "NESTED", ".cursor/rules/always.mdc": mdc("alwaysApply: true", "GLOBAL CURSOR"), ".cursor/rules/scoped.mdc": mdc('globs: "**/*.ts"', "SCOPED") };
  const result = workspaceRules(files, "MANUAL");
  for (const value of ["GLOBAL ANVIL", "GLOBAL AGENTS", "GLOBAL LEGACY", "GLOBAL CLAUDE", "GLOBAL CURSOR", "MANUAL"]) assert.ok(result.includes(value));
  assert.doesNotMatch(result, /NESTED|SCOPED/);
});

test("multiple active files receive their own scopes with shared ancestors only once", () => {
  const result = workspaceRules({ "AGENTS.md": "ROOT UNIQUE", "a/AGENTS.md": "A UNIQUE", "b/AGENTS.md": "B UNIQUE", "c/AGENTS.md": "C PRIVATE" }, "", ["a/one.ts", "b/two.ts", "a/three.ts"]);
  assert.equal(result.match(/ROOT UNIQUE/g)?.length, 1);
  assert.equal(result.match(/A UNIQUE/g)?.length, 1);
  assert.match(result, /B UNIQUE/);
  assert.doesNotMatch(result, /C PRIVATE/);
  assert.match(result, /a\/AGENTS\.md/);
  assert.match(result, /Geltungsbereich: a\//);
});

test("an explicit directory target selects its ancestors without selecting child projects", () => {
  const result = workspaceRules({ "AGENTS.md": "ROOT", "web/AGENTS.md": "WEB", "web/child/AGENTS.md": "CHILD PRIVATE" }, "", ["web/"]);
  assert.match(result, /WEB/);
  assert.doesNotMatch(result, /CHILD PRIVATE/);
});

test("specific scopes follow broad scopes and explicit user instructions come last", () => {
  const result = workspaceRules({ "AGENTS.md": "ROOT ORDER", "a/AGENTS.md": "PARENT ORDER", "a/deep/.anvil/rules.md": "DEEP ORDER" }, "USER ORDER", ["a/deep/file.ts"]);
  assert.ok(result.indexOf("ROOT ORDER") < result.indexOf("PARENT ORDER"));
  assert.ok(result.indexOf("PARENT ORDER") < result.indexOf("DEEP ORDER"));
  assert.ok(result.indexOf("DEEP ORDER") < result.indexOf("USER ORDER"));
});

test("Cursor globs use the owning scope, braces, basename globs and exclusions", () => {
  const files = {
    ".cursor/rules/ts.mdc": mdc('description: TypeScript conventions\nglobs: "**/*.{ts,tsx}, !**/*.test.ts"\nalwaysApply: false', "TS GUIDANCE"),
    "web/.cursor/rules/css.mdc": mdc('globs:\n  - "*.css"', "CSS GUIDANCE"),
    "api/.cursor/rules/css.mdc": mdc('alwaysApply: true', "API PRIVATE"),
  };
  assert.match(workspaceRules(files, "", ["web/components/view.tsx"]), /TS GUIDANCE/);
  assert.doesNotMatch(workspaceRules(files, "", ["web/view.test.ts"]), /TS GUIDANCE/);
  assert.match(workspaceRules(files, "", ["web/assets/style.css"]), /CSS GUIDANCE/);
  assert.doesNotMatch(workspaceRules(files, "", ["web/assets/style.css"]), /API PRIVATE/);
});

test("description-only rules remain unloaded until their rule file is explicitly targeted", () => {
  const path = ".cursor/rules/manual.mdc";
  const files = { [path]: mdc("description: Read when doing a security review\nalwaysApply: false", "MANUAL BODY") };
  assert.doesNotMatch(workspaceRules(files, "", ["src/main.ts"]), /MANUAL BODY/);
  assert.match(workspaceRules(files, "", [path]), /MANUAL BODY/);
});

test("unsafe targets and malicious rule paths never broaden selection", () => {
  const files = { "AGENTS.md": "SAFE GLOBAL", "safe/AGENTS.md": "SAFE LOCAL", "../AGENTS.md": "TRAVERSAL", "C:/AGENTS.md": "ABSOLUTE", "safe//AGENTS.md": "EMPTY SEGMENT", "safe/../other/AGENTS.md": "DOT SEGMENT", "safe/AGENTS.md:stream": "STREAM", "safe/NUL/AGENTS.md": "DEVICE" };
  for (const target of ["../safe/x.ts", "C:/safe/x.ts", "/safe/x.ts", "safe/../x.ts", "safe//x.ts", "safe/%2e%2e/x.ts", "safe/x.ts\nAGENTS.md", "safe./x.ts", "safe/NUL/x.ts"]) {
    const result = workspaceRules(files, "", [target]);
    assert.match(result, /SAFE GLOBAL/);
    assert.doesNotMatch(result, /SAFE LOCAL|TRAVERSAL|ABSOLUTE|EMPTY SEGMENT|DOT SEGMENT|STREAM|DEVICE/);
  }
});

test("case aliases resolve once but ambiguous files and directory spellings fail closed", () => {
  assert.match(workspaceRules({ "App/AGENTS.md": "UNIQUE CASE" }, "", ["app/main.ts"]), /UNIQUE CASE/);
  const conflict = { "AGENTS.md": "UPPER CASE", "Agents.md": "MIXED CASE", "app/AGENTS.md": "APP RULE", "App/main.ts": "ambiguous directory" };
  assert.doesNotMatch(workspaceRules(conflict, "", ["app/main.ts"]), /UPPER CASE|MIXED CASE|APP RULE/);
});

test("imported package guides and secret paths cannot introduce project-wide rules", () => {
  const files = { "AGENTS.md": "SAFE", ".anvil/skills/package-evil/AGENTS.md": "PLUGIN ROOT", ".anvil/skills/package-evil/.cursor/rules/always.mdc": mdc("alwaysApply: true", "PLUGIN RULE"), "secrets/AGENTS.md": "SECRET RULE", ".git/AGENTS.md": "GIT RULE", "node_modules/lib/AGENTS.md": "VENDOR RULE" };
  assert.doesNotMatch(workspaceRules(files, "", [".anvil/skills/package-evil/main.ts", "secrets/data.json", ".git/file", "node_modules/lib/main.ts"]), /PLUGIN ROOT|PLUGIN RULE|SECRET RULE|GIT RULE|VENDOR RULE/);
});

test("rule and explicit-user content are bounded and known credentials are redacted", () => {
  const result = workspaceRules({ "AGENTS.md": "RULE " + "x".repeat(12000) + " TAIL", ".anvil/rules.md": "token: 'abc-secret-credential'\nordinary instruction" }, "EXTRA " + "z".repeat(50000));
  assert.ok(result.length <= 32000);
  assert.doesNotMatch(result, /abc-secret-credential| TAIL/);
  assert.match(result, /ordinary instruction/);
  assert.match(result, /gekürzt/);
});

test("malformed or excessive metadata cannot make a Cursor rule unconditional", () => {
  const files = { ".cursor/rules/invalid.mdc": mdc('alwaysApply: "yes"\nglobs: ["**/*.ts"]', "INVALID ALWAYS"), ".cursor/rules/duplicate.mdc": mdc("alwaysApply: false\nalwaysApply: true", "DUPLICATE"), ".cursor/rules/oversize.mdc": mdc("description: " + "d".repeat(9000) + "\nalwaysApply: true", "OVERSIZE") };
  assert.doesNotMatch(workspaceRules(files, "", ["src/main.ts"]), /INVALID ALWAYS|DUPLICATE|OVERSIZE/);
});

test("available descriptions are bounded metadata without rule bodies or sibling descriptions", () => {
  const files = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [`web/.cursor/rules/manual-${i}.mdc`, mdc("description: " + "d".repeat(900), "PRIVATE BODY")])) as Record<string, string>;
  files["api/.cursor/rules/private.mdc"] = mdc("description: SIBLING DESCRIPTION", "SIBLING BODY");
  const result = ruleContext(files, ["web/main.ts"]);
  assert.equal(result.applied.length, 0);
  assert.equal(result.available.length, RULE_LIMITS.available);
  assert.equal(result.truncated, true);
  for (const item of result.available) assert.ok(item.description.length <= RULE_LIMITS.descriptionChars);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE BODY|SIBLING DESCRIPTION|SIBLING BODY/);
});

test("source limits, provenance and removed files are based on each current snapshot", () => {
  const files = { "AGENTS.md": "ROOT", "app/AGENTS.project.md": "PROJECT", "app/.anvil/rules": "LEGACY ANVIL", "app/.anvil/rules.md": "ANVIL" };
  const result = ruleContext(files, ["app/new.ts"]);
  assert.deepEqual(result.applied.map(item => [item.path, item.scope, item.reason]), [["AGENTS.md", "", "global"], ["app/AGENTS.project.md", "app", "ancestor"], ["app/.anvil/rules", "app", "ancestor"], ["app/.anvil/rules.md", "app", "ancestor"]]);
  assert.deepEqual(ruleFilesPresent({ "AGENTS.md": "ROOT" }, ["app/new.ts"]), ["AGENTS.md"]);
  const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`.cursor/rules/${String(i).padStart(2, "0")}.mdc`, mdc("alwaysApply: true", String(i) + " ".repeat(10) + "x".repeat(7000))]));
  const bounded = ruleContext(many);
  assert.ok(bounded.applied.length <= RULE_LIMITS.sources);
  assert.ok(workspaceRules(many).length <= RULE_LIMITS.contextChars);
  assert.equal(bounded.truncated, true);
});

test("malicious glob expansion, tags, path alternatives and display controls fail closed", () => {
  for (const header of [`globs: "${"x".repeat(300)}"`, 'globs: "{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}"', 'globs: "{..,src}/**"', 'globs: !!js/function "() => true"', 'globs: "../**"', 'globs: "**/[a-z].ts"']) {
    const result = ruleContext({ ".cursor/rules/malicious.mdc": mdc(header, "EVIL BODY") }, ["src/main.ts"]);
    assert.equal(result.applied.length, 0);
    assert.ok(result.warnings.length > 0);
  }
  assert.equal(ruleContext({ "safe/AGENTS.md": "SAFE" }, ["safe/\u202e.ts"]).targets.length, 0);
  assert.doesNotMatch(workspaceRules({ "AGENTS.md": "-----BEGIN PRIVATE KEY-----\n" + "a".repeat(20000) }), /a{20}/);
});
