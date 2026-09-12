import assert from "node:assert/strict";
import { test } from "node:test";
import { planSkillPackage, skillPackageFiles, skillPackageZip, planWebTaskPackage } from "./skill-package.ts";
import { parseSkillMd, serializeSkillMd } from "./learn-parse.ts";

const source = `---\nname: web-check\ndescription: "Check HTML after a change"\nlicense: MIT\nmetadata:\n  author: Example\nallowed-tools: read_file\n---\nRead references/check.md and do not run scripts automatically.\n`;
const input = { "web-check/SKILL.md": source, "web-check/references/check.md": "Expected: a button labelled Add.", "web-check/scripts/check.js": "throw new Error('never execute on import')", "web-check/assets/pixel.bin": "data:application/octet-stream;base64,AAEC/w==" };

test("imports a complete standard folder and exports its exact companion files", () => {
  const pack = planSkillPackage(input, { "index.html": "keep" }, [".anvil", ".anvil/skills"]);
  assert.equal(pack.skill.when, "Check HTML after a change");
  assert.equal(pack.count, 4);
  assert.equal(pack.files[pack.main], source);
  const exported = skillPackageFiles(pack.files, pack.main);
  assert.deepEqual(exported, Object.fromEntries(Object.entries(input).map(([path, body]) => [path.slice("web-check/".length), body])));
  assert.equal(pack.files["index.html"], undefined);
});

test("folder imports reject collisions including case and path traversal without overwriting", () => {
  assert.throws(() => planSkillPackage(input, { ".ANVIL/skills/WEB-CHECK/ref.md": "keep" }), /existiert/);
  assert.throws(() => planSkillPackage({ ...input, "web-check/../out.js": "bad" }, {}), /Paketpfad/);
  assert.throws(() => planSkillPackage({ ...input, "unrelated.txt": "other" }, {}), /außerhalb/);
  assert.throws(() => planSkillPackage({ ...input, "web-check/skill.md": source }, {}), /Genau ein/);
  assert.throws(() => planSkillPackage({ ...input, "web-check/references/CHECK.md": "conflict" }, {}), /Doppelter/);
});

test("malformed manifests fail visibly, full instructions and metadata survive serialization", () => {
  assert.throws(() => planSkillPackage({ "SKILL.md": "---\nname: x\n---\nRead the files." }, {}), /description/);
  assert.throws(() => planSkillPackage({ "skill.md": "---\ndescription: Read all files\n---\nRead the full instructions." }, {}), /name/);
  assert.throws(() => planSkillPackage({ "SKILL.md": source.replace("license: MIT", "license: [unterminated") }, {}), /YAML/);
  assert.throws(() => planSkillPackage({ "SKILL.md": source.replace("license: MIT", "name: duplicate") }, {}), /YAML/);
  const parsed = parseSkillMd(source.replace("Read references", "A".repeat(10000) + "Read references"), ".anvil/skills/web-check/SKILL.md")!;
  const exported = serializeSkillMd(parsed);
  const reread = parseSkillMd(exported)!;
  assert.equal(reread.body, parsed.body);
  assert.equal(reread.when, parsed.when);
  assert.match(exported, /license: MIT\nmetadata:\n  author: Example\nallowed-tools: read_file/);
});

test("offline ZIP encodes standard entries and binary files intact", () => {
  const files = skillPackageFiles(planSkillPackage(input, {}).files, ".anvil/skills/web-check/SKILL.md");
  const zip = skillPackageZip(files), view = new DataView(zip.buffer);
  let at = 0;
  const extracted: Record<string, Uint8Array> = {};
  while (view.getUint32(at, true) === 0x04034b50) {
    assert.equal(view.getUint16(at + 8, true), 0);
    const size = view.getUint32(at + 18, true), nameLength = view.getUint16(at + 26, true), extraLength = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(zip.slice(at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength + extraLength;
    extracted[name] = zip.slice(start, start + size); at = start + size;
  }
  assert.equal(view.getUint32(at, true), 0x02014b50);
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(zip.length - 12, true), 4);
  assert.equal(new TextDecoder().decode(extracted["SKILL.md"]), source);
  assert.deepEqual([...extracted["assets/pixel.bin"]], [0, 1, 2, 255]);
});

test("Web task package is additive, complete and rejects replacement", () => {
  const original = { "index.html": "existing app" };
  const pack = planWebTaskPackage(original);
  assert.equal(pack.main, "web-paket/index.html");
  assert.match(pack.files[pack.main], /task-form/);
  assert.ok(pack.files[".anvil/skills/kleine-webanwendung/references/abnahme.md"]);
  assert.deepEqual(original, { "index.html": "existing app" });
  assert.throws(() => planWebTaskPackage({ "web-paket/index.html": "existing" }), /existiert/);
});

test("Web package appends its actual acceptance scenario and preserves existing checks", () => {
  const original = { id: "own", name: "Own check", entry: "index.html", steps: [{ action: "visible", selector: "main" }] };
  const path = ".anvil/interaction-checks.json";
  const pack = planWebTaskPackage({ [path]: JSON.stringify({ version: 1, scenarios: [original] }) });
  const checks = JSON.parse(pack.files[path]);
  assert.deepEqual(checks.scenarios[0], original);
  assert.equal(checks.scenarios[1].entry, pack.main);
  assert.ok(checks.scenarios[1].steps.some((step: { action: string }) => step.action === "count"));
  assert.throws(() => planWebTaskPackage({ [path]: "broken json" }), /ungültig/);
  assert.throws(() => planWebTaskPackage({ [path]: JSON.stringify({ version: 7, scenarios: [] }) }), /unbekannt/);
  assert.throws(() => planWebTaskPackage({ [path]: JSON.stringify({ version: 1, scenarios: [{ ...original, steps: [] }] }) }), /Schritte/);
});
