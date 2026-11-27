import test from "node:test";
import assert from "node:assert/strict";
import { discoverAgentPlugins, inspectAgentPlugin, normalizePluginPath } from "./agent-plugin-package.ts";

const manifestSchema = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const mcpSchema = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
const skill = (name = "review") => `---\nname: ${name}\ndescription: Review the project when requested.\n---\nRead references/check.md and examine the requested change.\n`;
const standard = (extra = {}) => JSON.stringify({ $schema: manifestSchema, name: "reviewer", ...extra });

test("standard package preserves relative resource layout and imports fixed skills and HTTPS service", () => {
  const pack = inspectAgentPlugin({
    "repo/reviewer/plugin.json": standard({ license: "MIT", version: "2.0.0" }),
    "repo/reviewer/skills/review/SKILL.md": skill(),
    "repo/reviewer/skills/review/references/check.md": "Check the diff.",
    "repo/reviewer/mcp.json": JSON.stringify({ $schema: mcpSchema, mcpServers: { docs: { type: "streamable-http", url: "https://example.org/mcp" } } }),
  });
  assert.equal(pack.format, "agent");
  assert.equal(pack.manifest, "plugin.json");
  assert.deepEqual(pack.skills, ["skills/review/SKILL.md"]);
  assert.equal(pack.files["skills/review/references/check.md"], "Check the diff.");
  assert.deepEqual(pack.servers, [{ name: "docs", url: "https://example.org/mcp" }]);
  assert.equal(pack.components.filter(c => c.supported).length, 2);
});

test("Codex custom paths supplement defaults and inline MCP is understood", () => {
  const pack = inspectAgentPlugin({
    ".codex-plugin/plugin.json": JSON.stringify({ name: "codex-example", skills: "./other/", mcpServers: { remote: { type: "http", url: "https://example.org/mcp" } }, apps: "./.app.json" }),
    "skills/default/SKILL.md": skill("default"), "other/custom/SKILL.md": skill("custom"), ".app.json": '{"apps":{}}',
  });
  assert.equal(pack.format, "codex");
  assert.equal(pack.skills.length, 2);
  assert.equal(pack.servers.length, 1);
  assert.equal(pack.components.find(c => c.kind === "apps")?.supported, false);
});

test("Cursor explicit paths replace discovery and can wrap inline mcpServers", () => {
  const pack = inspectAgentPlugin({
    ".cursor-plugin/plugin.json": JSON.stringify({ name: "cursor.example", skills: ["./custom/"], mcpServers: [{ mcpServers: { remote: { url: "https://example.org/mcp" } } }] }),
    "skills/ignored/SKILL.md": skill("ignored"), "custom/review/SKILL.md": skill(),
    "mcp.json": JSON.stringify({ mcpServers: { ignored: { url: "https://example.org/ignored" } } }),
    "rules/review.mdc": "Always review", "hooks/hooks.json": "{}", "agents/person.md": "instructions", "commands/deploy.md": "instructions",
  });
  assert.deepEqual(pack.skills, ["custom/review/SKILL.md"]);
  assert.deepEqual(pack.servers.map(s => s.name), ["remote"]);
  for (const kind of ["rules", "hooks", "agents", "commands"]) assert.equal(pack.components.find(c => c.kind === kind)?.supported, false);
  assert.equal(pack.files["skills/ignored/SKILL.md"], skill("ignored"));
});

test("Cursor root skill fallback only applies without skills directory or explicit field", () => {
  const input = { ".cursor-plugin/plugin.json": '{"name":"root-skill"}', "SKILL.md": skill() };
  assert.deepEqual(inspectAgentPlugin(input).skills, ["SKILL.md"]);
  assert.deepEqual(inspectAgentPlugin({ ...input, "skills/readme.md": "empty folder" }).skills, []);
  assert.deepEqual(inspectAgentPlugin({ ...input, ".cursor-plugin/plugin.json": '{"name":"root-skill","skills":[]}' }).skills, []);
});

test("root manifest is canonical, host overlays are preserved but not merged", () => {
  const input = { "plugin.json": standard(), ".codex-plugin/plugin.json": '{"name":"other","skills":"./private/"}', "private/review/SKILL.md": skill(), "skills/review/SKILL.md": skill() };
  assert.equal(discoverAgentPlugins(input).length, 1);
  const pack = inspectAgentPlugin(input);
  assert.deepEqual(pack.skills, ["skills/review/SKILL.md"]);
  assert.ok(pack.components.some(c => c.kind === "overlay" && !c.supported));
  assert.throws(() => inspectAgentPlugin(input, ".codex-plugin/plugin.json"), /kanonische/);
});

test("multi-plugin source requires choice and contains selected root only", () => {
  const input = { "one/plugin.json": standard(), "one/skills/review/SKILL.md": skill(), "two/.cursor-plugin/plugin.json": '{"name":"second"}', "README.md": "repository" };
  assert.equal(discoverAgentPlugins(input).length, 2);
  assert.throws(() => inspectAgentPlugin(input), /Mehrere Plugins/);
  const pack = inspectAgentPlugin(input, "one/plugin.json");
  assert.deepEqual(Object.keys(pack.files).sort(), ["plugin.json", "skills/review/SKILL.md"]);
});

test("manifest schema and metadata types are validated without accepting another version", () => {
  for (const body of ["null", "{", '{"name":"no-schema"}', standard({ $schema: manifestSchema.replace("1.0.0", "2.0.0") }), standard({ name: "A B" }), standard({ version: 1 }), standard({ author: [] }), standard({ keywords: [1] }), standard({ extensions: { "com.openai": "bad" } })]) {
    assert.throws(() => inspectAgentPlugin({ "plugin.json": body }));
  }
  const pack = inspectAgentPlugin({ "plugin.json": standard({ custom: true, extensions: { "com.openai": { hooks: "./hooks.json" } } }) });
  assert.ok(pack.warnings.some(w => w.includes("custom")));
  assert.ok(pack.components.some(c => c.kind === "extensions" && !c.supported));
});

test("unsafe Windows paths, traversal and case/file conflicts are rejected", () => {
  for (const path of ["../plugin.json", "/plugin.json", "C:/plugin.json", "a//file", "a/./file", "a/NUL.txt", "a/COM¹.txt", "a/file.", "a/file ", "a/file:stream", "a\u0000/file"]) assert.throws(() => normalizePluginPath(path));
  assert.equal(normalizePluginPath("skills\\review\\SKILL.md"), "skills/review/SKILL.md");
  const conflicts: Record<string, string>[] = [ { "plugin.json": standard(), "PLUGIN.json": standard() }, { "plugin.json": standard(), a: "file", "a/b": "child" } ];
  for (const input of conflicts) assert.throws(() => inspectAgentPlugin(input));
  assert.throws(() => inspectAgentPlugin({ ".cursor-plugin/plugin.json": '{"name":"unsafe","skills":"../../outside"}' }));
});

test("invalid or duplicate skills remain visible as unsupported components", () => {
  const pack = inspectAgentPlugin({ "plugin.json": standard(), "skills/a/SKILL.md": skill(), "skills/b/SKILL.md": skill(), "skills/bad/SKILL.md": "No front matter here." });
  assert.equal(pack.skills.length, 0);
  assert.equal(pack.components.filter(c => c.kind === "skill" && !c.supported).length, 3);
});

test("unsupported server options never silently become a usable unauthenticated endpoint", () => {
  for (const config of [
    { url: "https://example.org/mcp", headers: { Authorization: "Bearer ${TOKEN}" } },
    { url: "https://example.org/mcp", headers: { "X-Tenant": "tenant" } },
    { command: "node", args: ["server.js"] },
    { url: "https://example.org/mcp", cwd: "./server" },
    { url: "https://example.org/mcp", env: { MODE: "test" } },
    { url: "https://${HOST}/mcp" },
    { type: "sse", url: "https://example.org/sse" },
    { url: "http://example.org/mcp" },
    { url: "https://example.org/mcp?tenant=123" },
    { url: "https://example.org/mcp", auth: { type: "oauth", clientId: "client" } },
  ]) {
    const pack = inspectAgentPlugin({ ".cursor-plugin/plugin.json": JSON.stringify({ name: "remote", mcpServers: { remote: config } }) });
    assert.deepEqual(pack.servers, []);
    assert.ok(pack.components.some(c => c.kind === "mcp" && !c.supported));
  }
});

test("embedded credentials are refused without echoing their values", () => {
  for (const config of [
    { url: "https://example.org/mcp", headers: { Authorization: "Bearer very-secret" } },
    { command: "tool", env: { API_TOKEN: "very-secret" } },
    { url: "https://user:very-secret@example.org/mcp" },
    { url: "https://example.org/mcp?api_key=very-secret" },
  ]) {
    assert.throws(() => inspectAgentPlugin({ ".codex-plugin/plugin.json": JSON.stringify({ name: "secret", mcpServers: { remote: config } }) }), error => error instanceof Error && /Zugangsdaten/.test(error.message) && !error.message.includes("very-secret"));
  }
  for (const path of [".env", ".env.local", "keys/id_ed25519", "credentials.json"]) assert.throws(() => inspectAgentPlugin({ "plugin.json": standard(), [path]: "private" }));
});

test("package and repository bounds are separate and identity encoding avoids dotted-name collisions", () => {
  assert.notEqual(inspectAgentPlugin({ ".cursor-plugin/plugin.json": '{"name":"a.b"}' }).id, inspectAgentPlugin({ ".cursor-plugin/plugin.json": '{"name":"a-b"}' }).id);
  const tooMany = Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`file${i}.md`, "text"]));
  assert.throws(() => inspectAgentPlugin({ ...tooMany, "plugin.json": standard() }), /300/);
  assert.throws(() => discoverAgentPlugins(Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`file${i}`, ""]))), /1000/);
  assert.throws(() => inspectAgentPlugin({ "plugin.json": standard(), "large.txt": "x".repeat(16 * 1024 * 1024) }), /16 MiB/);
});

test("duplicate service names remain disabled instead of choosing one configuration", () => {
  const pack = inspectAgentPlugin({
    ".codex-plugin/plugin.json": JSON.stringify({ name: "duplicate", mcpServers: { remote: { url: "https://example.org/second" } } }),
    ".mcp.json": JSON.stringify({ mcpServers: { remote: { url: "https://example.org/first" } } }),
  });
  assert.deepEqual(pack.servers, []);
  assert.equal(pack.components.filter(c => c.kind === "mcp" && !c.supported).length, 2);
});
