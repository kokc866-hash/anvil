import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createServer } from "vite";

test("imported plugins retain lifecycle, project isolation and exact skill selection", async t => {
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } }, ssr: { external: ["react", "react-dom", "zustand", "js-yaml"] }, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  t.after(() => server.close());
  const { useIde } = await server.ssrLoadModule("/src/store/ide.ts");
  const { useLearn, hydrateLearnFromFiles, agentLearn, LEARN_DEFAULTS } = await server.ssrLoadModule("/src/lib/learn.ts");
  const { inspectAgentPlugin } = await server.ssrLoadModule("/src/lib/agent-plugin-package.ts");
  const { pluginCompatibility } = await server.ssrLoadModule("/src/lib/agent-plugin-compatibility.ts");
  const { installAgentPlugin, enableAgentPlugin, removeAgentPlugin } = await server.ssrLoadModule("/src/lib/agent-plugin-install.ts");
  const { pluginRoot, pluginRecord, pluginOwnedPaths, importedAgentPlugins, importedSkillPaths } = await server.ssrLoadModule("/src/lib/agent-plugin-registry.ts");
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { if (!String(args[0]).startsWith("[zustand persist middleware]")) warn(...args); };
  t.after(() => { console.warn = warn; });
  const skill = (name: string) => `---\nname: ${name}\ndescription: Review changes and supporting resources.\nscope: user\nkind: plugin\n---\nRead references/check.md. Review the requested changes carefully.\n`;
  const pack = inspectAgentPlugin({
    ".cursor-plugin/plugin.json": '{"name":"life-cycle","skills":"./custom/"}',
    "custom/review/SKILL.md": skill("review"),
    "custom/review/references/check.md": "Reference retained.",
    "custom/review/scripts/check.js": "throw new Error('must not execute')",
    "skills/ignored/SKILL.md": skill("ignored"),
  });
  const root = pluginRoot(pack.id), selected = `${root}/custom/review/SKILL.md`;
  useIde.setState({ workspaceCwd: "", workspaceMemoryId: "plugin-a", githubRepo: "", diskName: "", workspaceEpoch: 71, agentBusy: false, pathOperation: null,
    files: { "keep.txt": "untouched" }, dirs: [], dirty: {}, editBases: {}, pendingDiffs: [], openPaths: [], attached: [], recentPaths: [], undo: {}, breakpoints: {}, testResults: [] });
  useLearn.setState({ on: true, prefs: { ...LEARN_DEFAULTS }, skills: [], forgotten: [], activeSkills: [] });

  await t.test("foreground, background and resume preserve input while package files change", async () => {
    const { trySendBackground } = await server.ssrLoadModule("/src/lib/background-agent.ts");
    const { sendChat } = await server.ssrLoadModule("/src/lib/chat-session.ts");
    const input = { draft: "Review the project", images: [], title: "", setDraft: () => assert.fail("draft cleared"), setImages: () => assert.fail("images cleared"), setMention: () => assert.fail("mention cleared"), setTitle: () => assert.fail("title changed") };
    useIde.setState({ pathOperation: { from: "", to: "" }, locale: "de" });
    for (const backgroundAgent of [false, true]) {
      useIde.setState({ backgroundAgent });
      assert.equal(await trySendBackground(input, "agent"), true);
      await sendChat(input, { onAccepted: () => assert.fail("request accepted") });
      assert.equal(useIde.getState().agentBusy, false);
    }
    assert.equal(await trySendBackground(input, "agent", { id: "held-job", reviewed: true }), true);
    useIde.setState({ pathOperation: null, backgroundAgent: false });
  });

  await t.test("install is disabled, resources preserved, duplicate import cannot overwrite", async () => {
    await installAgentPlugin({ ...pack, skills: ["skills/ignored/SKILL.md"], servers: [{ name: "forged", url: "https://example.org/not-in-manifest" }] }, "test fixture", 71);
    const before = { ...useIde.getState().files };
    assert.equal(importedAgentPlugins(before)[0].enabled, false);
    assert.deepEqual(importedAgentPlugins(before)[0].skills, ["custom/review/SKILL.md"], "install inspects source instead of trusting preview metadata");
    assert.deepEqual(importedAgentPlugins(before)[0].servers, []);
    assert.equal(before[`${root}/custom/review/references/check.md`], "Reference retained.");
    assert.equal(importedSkillPaths(before).size, 0);
    assert.deepEqual(await agentLearn("skills", {}), []);
    await assert.rejects(() => installAgentPlugin(pack, "test fixture", 71), /existiert/);
    assert.deepEqual(useIde.getState().files, before);
  });

  let firstId = "";
  await t.test("activation imports exact declared skill as project guide and resolves resources", async () => {
    await enableAgentPlugin(pack.id, true);
    const active = useLearn.getState().skills;
    assert.equal(active.length, 1);
    assert.equal(active[0].name, "review");
    assert.equal(active[0].scope, "project");
    assert.equal(active[0].kind, "guide");
    assert.equal(active[0].file, selected);
    firstId = active[0].id;
    assert.deepEqual([...importedSkillPaths(useIde.getState().files)], [selected]);
    const run = await agentLearn("run", { name: firstId });
    assert.equal(run.baseDirectory, `${root}/custom/review`);
    assert.ok(run.resources.includes(`${root}/custom/review/references/check.md`));
    assert.ok(run.resources.includes(`${root}/custom/review/scripts/check.js`));
    assert.match(run.body, /Review the requested changes/);
    assert.equal(useIde.getState().files[`${root}/custom/review/scripts/check.js`], "throw new Error('must not execute')");
    assert.deepEqual(await agentLearn("run", { name: "ignored" }), { error: "no skill" });
  });

  await t.test("disable removes list/run access and stays disabled after hydration", async () => {
    await enableAgentPlugin(pack.id, false);
    assert.deepEqual(await agentLearn("skills", {}), []);
    assert.deepEqual(await agentLearn("run", { name: firstId }), { error: "no skill" });
    hydrateLearnFromFiles(useIde.getState().files);
    assert.equal(useLearn.getState().skills.length, 0);
    assert.equal(importedAgentPlugins(useIde.getState().files)[0].enabled, false);
    assert.ok(useIde.getState().files[selected]);
    await enableAgentPlugin(pack.id, true);
  });

  let firstFiles: Record<string, string>;
  let secondId = "";
  await t.test("same plugin in another project has separate identity and survives removal elsewhere", async () => {
    firstFiles = { ...useIde.getState().files };
    firstId = useLearn.getState().skills[0].id;
    useIde.setState({ files: {}, dirty: {}, editBases: {}, workspaceMemoryId: "plugin-b", workspaceEpoch: 72 });
    await installAgentPlugin(pack, "same package, second project", 72);
    await enableAgentPlugin(pack.id, true);
    const all = useLearn.getState().skills;
    assert.equal(all.length, 2);
    secondId = all.find((s: { ws: string }) => s.ws === "v2:local:plugin-b").id;
    assert.notEqual(secondId, firstId);
    const snapshot = { ...useIde.getState().files };
    useIde.setState({ files: firstFiles, dirty: {}, editBases: {}, workspaceMemoryId: "plugin-a", workspaceEpoch: 73 });
    const expected = Object.fromEntries(pluginOwnedPaths(firstFiles, pack.id).map((p: string) => [p, firstFiles[p]]));
    await removeAgentPlugin(pack.id, expected, 73);
    assert.deepEqual(useIde.getState().files, { "keep.txt": "untouched" });
    assert.equal(useIde.getState().files[pluginRecord(pack.id)], undefined);
    assert.ok(useLearn.getState().skills.some((s: { id: string }) => s.id === secondId));
    assert.deepEqual(await agentLearn("run", { name: "review" }), { error: "no skill" });
    useIde.setState({ files: snapshot, dirty: {}, editBases: {}, workspaceMemoryId: "plugin-b", workspaceEpoch: 74 });
    hydrateLearnFromFiles(snapshot);
    assert.equal((await agentLearn("run", { name: secondId })).skill, "review");
  });

  await t.test("stale deletion, busy workspace and stale epoch fail without mutation", async () => {
    const files = { ...useIde.getState().files };
    const expected = Object.fromEntries(pluginOwnedPaths(files, pack.id).map((p: string) => [p, files[p]]));
    useIde.setState({ files: { ...files, [selected]: files[selected] + "\nEdited after preview." } });
    await assert.rejects(() => removeAgentPlugin(pack.id, expected, 74), /inzwischen geändert/);
    useIde.setState({ files, agentBusy: true });
    await assert.rejects(() => enableAgentPlugin(pack.id, false), /bearbeitet/);
    useIde.setState({ agentBusy: false, pathOperation: { from: "a", to: "b" } });
    await assert.rejects(() => enableAgentPlugin(pack.id, false), /bearbeitet/);
    useIde.setState({ pathOperation: null });
    await assert.rejects(() => removeAgentPlugin(pack.id, expected, 73), /gewechselt/);
    assert.deepEqual(useIde.getState().files, files);
  });

  await t.test("changed registry, changed manifest and missing source cannot activate excluded or incomplete skills", async () => {
    await enableAgentPlugin(pack.id, false);
    const clean = { ...useIde.getState().files };
    const recordPath = pluginRecord(pack.id);
    const variants: Record<string, string>[] = [
      { ...clean, [recordPath]: JSON.stringify({ ...JSON.parse(clean[recordPath]), skills: ["skills/ignored/SKILL.md"] }) },
      { ...clean, [`${root}/.cursor-plugin/plugin.json`]: '{"name":"life-cycle","skills":"./skills/"}' },
      Object.fromEntries(Object.entries(clean).filter(([p]) => p !== selected)),
      Object.fromEntries(Object.entries(clean).filter(([p]) => p !== `${root}/.cursor-plugin/plugin.json`)),
    ];
    for (const variant of variants) {
      const claimedEnabled = { ...variant, [recordPath]: JSON.stringify({ ...JSON.parse(variant[recordPath]), enabled: true }) };
      useIde.setState({ files: claimedEnabled, dirty: {}, editBases: {} });
      assert.equal(importedSkillPaths(claimedEnabled).size, 0, "a fresh file snapshot is revalidated before agent exposure");
      hydrateLearnFromFiles(claimedEnabled);
      assert.deepEqual(await agentLearn("skills", {}), []);
      assert.deepEqual(await agentLearn("run", { name: "ignored" }), { error: "no skill" });
      assert.deepEqual(await agentLearn("run", { name: secondId }), { error: "no skill" });
      useIde.setState({ files: { ...variant } });
      const before = { ...useIde.getState().files };
      await assert.rejects(() => enableAgentPlugin(pack.id, true));
      assert.deepEqual(useIde.getState().files, before, "failed activation does not rewrite the package or registry");
      assert.equal(importedAgentPlugins(useIde.getState().files)[0].enabled, false);
    }
    useIde.setState({ files: clean, dirty: {}, editBases: {} });
    await enableAgentPlugin(pack.id, true);
    assert.equal((await agentLearn("run", { name: "review" })).skill, "review");
  });

  await t.test("mixed package compatibility follows real import, activation, disable and reimport", async () => {
    const mixed = inspectAgentPlugin({
      ".cursor-plugin/plugin.json": JSON.stringify({ name: "mixed-lifecycle", license: "MIT", mcpServers: { docs: { url: "https://example.org/mcp" } }, hooks: "./hooks/", rules: "./rules/" }),
      "skills/mixed/SKILL.md": skill("mixed-review"),
      "hooks/hooks.json": '{"sessionStart":[{"command":"must-not-run"}]}',
      "rules/check.mdc": "---\nalwaysApply: true\n---\nThis must remain inactive.",
    });
    const status = () => {
      const files = useIde.getState().files;
      return pluginCompatibility(importedAgentPlugins(files).find((item: { id: string }) => item.id === mixed.id), { files, skillPaths: importedSkillPaths(files) });
    };
    await installAgentPlugin(mixed, "mixed synthetic fixture", 74);
    assert.equal(status().usable, 0);
    assert.equal(status().parts.find((part: { kind: string }) => part.kind === "skill").status, "setup-required");
    await enableAgentPlugin(mixed.id, true);
    assert.equal(status().usable, 1);
    assert.equal(status().parts.find((part: { kind: string }) => part.kind === "mcp").status, "setup-required");
    for (const kind of ["hooks", "rules"]) assert.equal(status().parts.find((part: { kind: string }) => part.kind === kind).status, "unsupported");
    assert.equal((await agentLearn("run", { name: "mixed-review" })).skill, "mixed-review");
    await enableAgentPlugin(mixed.id, false);
    assert.equal(status().usable, 0);
    assert.deepEqual(await agentLearn("run", { name: "mixed-review" }), { error: "no skill" });
    const files = useIde.getState().files;
    await removeAgentPlugin(mixed.id, Object.fromEntries(pluginOwnedPaths(files, mixed.id).map((path: string) => [path, files[path]])), 74);
    await installAgentPlugin(mixed, "mixed fixture reimported", 74);
    assert.equal(status().usable, 0, "reimport does not restore earlier activation");
    assert.equal(importedAgentPlugins(useIde.getState().files).find((item: { id: string }) => item.id === mixed.id).enabled, false);
    assert.deepEqual(useIde.getState().mcpServers, [], "compatibility inspection never creates or opens a service");
  });
});
