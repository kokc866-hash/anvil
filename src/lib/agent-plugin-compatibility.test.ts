import assert from "node:assert/strict";
import test from "node:test";
import { pluginCompatibility } from "./agent-plugin-compatibility.ts";
import { inspectAgentPlugin } from "./agent-plugin-package.ts";
import { agentPluginInstallFiles, importedAgentPlugins, pluginRecord, pluginRoot } from "./agent-plugin-registry.ts";

const source = {
  ".cursor-plugin/plugin.json": JSON.stringify({ name: "mixed-status", license: "MIT", mcpServers: { docs: { url: "https://example.org/mcp" }, local: { command: "node", args: ["server.mjs"] } }, rules: "./rules/", hooks: "./hooks/" }),
  "skills/review/SKILL.md": "---\nname: review\ndescription: Review requested changes.\n---\nRead references/check.md before reviewing.",
  "skills/review/scripts/check.mjs": "throw new Error('must never execute during import')",
  "rules/check.mdc": "---\nalwaysApply: true\n---\nPACKAGE RULE MUST STAY INACTIVE",
  "hooks/hooks.json": '{"sessionStart":[{"command":"must-not-run"}]}',
};
const pack = () => inspectAgentPlugin(source);
const installed = () => { const value = pack(); return { value, files: agentPluginInstallFiles(value, "synthetic fixture", {}) }; };

test("mixed preview reports compatibility per component without claiming activation", () => {
  const result = pluginCompatibility(pack());
  assert.equal(result.valid, true);
  assert.equal(result.installed, false);
  assert.equal(result.partial, true);
  assert.equal(result.parts.find(part => part.kind === "skill")?.status, "usable");
  assert.equal(result.parts.find(part => part.kind === "skill")?.state, "not-imported");
  assert.equal(result.parts.find(part => part.label === "docs")?.status, "setup-required");
  assert.equal(result.parts.find(part => part.label === "local")?.status, "setup-required");
  for (const kind of ["hooks", "rules"]) assert.equal(result.parts.find(part => part.kind === kind)?.status, "unsupported");
  assert.equal(result.parts.find(part => part.kind === "scripts")?.status, "setup-required");
  assert.match(result.parts.find(part => part.kind === "skill")!.reason, /deaktiviert importiert/);
});

test("installed package is disabled and services are unconnected until explicitly configured", () => {
  const { files } = installed(), record = importedAgentPlugins(files)[0];
  const result = pluginCompatibility(record, { files });
  assert.equal(result.usable, 0);
  assert.equal(result.parts.find(part => part.kind === "skill")?.state, "disabled");
  assert.match(result.parts.find(part => part.label === "docs")!.reason, /keine passende Dienstverbindung/);
});

test("enabling skills does not enable hooks, rules, scripts or services", () => {
  const { value, files } = installed();
  files[pluginRecord(value.id)] = JSON.stringify({ ...importedAgentPlugins(files)[0], enabled: true });
  const result = pluginCompatibility(importedAgentPlugins(files)[0], { files, skillPaths: new Set([`${pluginRoot(value.id)}/skills/review/SKILL.md`]) });
  assert.equal(result.usable, 1);
  assert.equal(result.parts.find(part => part.kind === "skill")?.state, "available");
  assert.equal(result.parts.find(part => part.label === "docs")?.status, "setup-required");
  assert.equal(result.parts.find(part => part.kind === "hooks")?.status, "unsupported");
  assert.equal(result.parts.find(part => part.kind === "rules")?.status, "unsupported");
  assert.match(result.parts.find(part => part.kind === "scripts")!.reason, /führen sie nicht aus/);
});

test("current skill-system exclusion is reflected without changing the package", () => {
  const { value, files } = installed();
  files[pluginRecord(value.id)] = JSON.stringify({ ...importedAgentPlugins(files)[0], enabled: true });
  const before = JSON.stringify(files);
  const result = pluginCompatibility(importedAgentPlugins(files)[0], { files, skillPaths: new Set() });
  assert.equal(result.parts.find(part => part.kind === "skill")?.status, "setup-required");
  assert.equal(JSON.stringify(files), before);
});

test("MCP compatibility requires matching auth, readiness and actually available capabilities", () => {
  const { files } = installed(), record = importedAgentPlugins(files)[0];
  const check = (extra: object) => pluginCompatibility(record, { files, services: [{ url: "https://example.org/mcp", auth: "oauth", enabled: true, ...extra }] }).parts.find(part => part.label === "docs")!;
  assert.equal(check({ enabled: false }).status, "setup-required");
  assert.equal(check({ ready: false, tools: 3 }).status, "setup-required");
  assert.equal(check({ ready: true, tools: 0, resources: 0 }).status, "setup-required");
  assert.equal(check({ ready: true, tools: 3, auth: "bearer" }).status, "setup-required");
  assert.equal(check({ ready: true, tools: 3 }).status, "usable");
  assert.equal(check({ ready: true, resources: 1 }).status, "usable");
});

test("an unrelated service never makes the package usable", () => {
  const { files } = installed(), record = importedAgentPlugins(files)[0];
  const result = pluginCompatibility(record, { files, services: [{ url: "https://other.example.org/mcp", enabled: true, ready: true, tools: 5 }] });
  assert.equal(result.parts.find(part => part.label === "docs")?.status, "setup-required");
});

test("changed source, manifest or claimed status does not bypass fresh package inspection", () => {
  const { value, files } = installed(), record = importedAgentPlugins(files)[0];
  const missing = Object.fromEntries(Object.entries(files).filter(([path]) => path !== `${pluginRoot(value.id)}/skills/review/SKILL.md`));
  const changed = { ...files, [`${pluginRoot(value.id)}/.cursor-plugin/plugin.json`]: '{"name":"mixed-status","skills":"absent"}' };
  for (const snapshot of [missing, changed, {}]) {
    const result = pluginCompatibility({ ...record, enabled: true, components: record.components.map(part => ({ ...part, status: "usable", supported: true })) }, { files: snapshot });
    assert.equal(result.valid, false);
    assert.equal(result.usable, 0);
    assert.ok(result.parts.every(part => part.status === "unsupported"));
  }
});

test("old records without status are compatible and reimport starts disabled again", () => {
  const { value, files } = installed(), record = importedAgentPlugins(files)[0];
  files[pluginRecord(value.id)] = JSON.stringify({ ...record, enabled: true, components: record.components.map(({ status: _status, ...part }) => part) });
  const active = pluginCompatibility(importedAgentPlugins(files)[0], { files });
  assert.equal(active.parts.find(part => part.kind === "skill")?.status, "usable");
  const second = agentPluginInstallFiles(value, "reimported fixture", {});
  const again = pluginCompatibility(importedAgentPlugins(second)[0], { files: second });
  assert.equal(again.parts.find(part => part.kind === "skill")?.status, "setup-required");
  assert.equal(again.usable, 0);
});

test("invalid skills and duplicate services never retain an earlier usable status", () => {
  const invalid = inspectAgentPlugin({ ".codex-plugin/plugin.json": '{"name":"duplicates","mcpServers":{"remote":{"url":"https://example.org/two"}}}', ".mcp.json": '{"mcpServers":{"remote":{"url":"https://example.org/one"}}}', "skills/a/SKILL.md": source["skills/review/SKILL.md"], "skills/b/SKILL.md": source["skills/review/SKILL.md"] });
  assert.equal(invalid.skills.length, 0);
  assert.equal(invalid.servers.length, 0);
  assert.ok(invalid.components.every(part => part.status === "unsupported" && !part.supported));
});
