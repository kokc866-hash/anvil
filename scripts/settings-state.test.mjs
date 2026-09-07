import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";
import path from "node:path";

test("settings backups, reset and model changes preserve connection and project intent", async (t) => {
  const values = new Map();
  const timers = new Set();
  globalThis.localStorage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) };
  globalThis.window = Object.assign(new EventTarget(), { localStorage,
    setTimeout: (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; },
    clearTimeout: (id) => { timers.delete(id); clearTimeout(id); },
  });
  globalThis.document = Object.assign(new EventTarget(), { documentElement: { lang: "de" } });
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => { requests.push(String(url)); throw new Error("No network in settings fixture"); };
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } }, server: { middlewareMode: true, hmr: false }, appType: "custom" });
  t.after(async () => {
    const { flushPersistence } = await server.ssrLoadModule("/src/lib/persist-storage.ts");
    const { flushSecrets } = await server.ssrLoadModule("/src/lib/secrets.ts");
    const { useIntern } = await server.ssrLoadModule("/src/lib/intern.ts");
    useIntern.getState().setPrefs({ on: false, autoHeal: false });
    await flushPersistence().catch(assertNoIndexedDb); await flushSecrets();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await server.close();
    for (const id of timers) clearTimeout(id);
    globalThis.fetch = originalFetch;
    delete globalThis.localStorage; delete globalThis.window; delete globalThis.document;
  });
  const { useIde } = await server.ssrLoadModule("/src/store/ide.ts");
  const { useBrain } = await server.ssrLoadModule("/src/lib/brain/store.ts");
  const { useLearn } = await server.ssrLoadModule("/src/lib/learn.ts");
  const { useModelLib } = await server.ssrLoadModule("/src/lib/model-lib.ts");
  const { useIntern } = await server.ssrLoadModule("/src/lib/intern.ts");
  useIntern.getState().setPrefs({ on: false, autoHeal: false });
  await useIde.persist.rehydrate(); await useBrain.persist.rehydrate();
  const { exportSettingsPack, applySettingsPack, resetAllSettings, resetSettingsCategory } = await server.ssrLoadModule("/src/lib/settings-io.ts");
  const s = useIde.getState();
  const clone = (v) => JSON.parse(JSON.stringify(v));
  s.setLlmProvider("anthropic", "abo");
  s.setLlmApiKey("fixture-anthropic-secret");
  s.setLlmModel("claude-sonnet-4-5"); s.setLlmContextAuto(false); s.setLlmContext(8192);
  s.setLlmThinking("high"); s.setLlmTemperature(0.7); s.setLlmMaxOut(4096);
  s.saveLlmProfile("Saved CLI");
  useIde.setState({ netCompiler: false, trailThinkH: 312, sidebarWidth: 210 });
  useBrain.setState({ autoLoad: true, autoUpdate: false, autoProfile: false });
  useBrain.getState().saveHelperProfile("Saved helper");
  useModelLib.setState({ cacheBackend: "indexeddb", prefetchOnStart: true });
  const backup = clone(exportSettingsPack());
  const { flushPersistence } = await server.ssrLoadModule("/src/lib/persist-storage.ts");
  await flushPersistence().catch(assertNoIndexedDb);
  assert.equal(JSON.parse(values.get("anvil-llm")).llmAuthMode, "abo", "Recovery snapshot also retains CLI mode");
  assert.equal(backup.ide.llmAuthMode, "abo");
  assert.ok(backup.ide.llmSlots["anthropic:abo"]);
  assert.equal(JSON.stringify(backup).includes("fixture-anthropic-secret"), false);
  s.setLlmProvider("ollama", "key"); s.setLlmApiKey("fixture-local-secret");
  s.saveLlmProfile("Keep local profile");
  const observed = [];
  const unsubscribe = useIde.subscribe((state) => observed.push([state.llmProvider, state.llmAuthMode, state.llmApiKey]));
  applySettingsPack(backup); unsubscribe();
  assert.equal(useIde.getState().llmAuthMode, "abo");
  assert.equal(useIde.getState().llmApiKey, "fixture-anthropic-secret");
  assert.ok(observed.every(([provider, , key]) => provider !== "anthropic" || key === "fixture-anthropic-secret"));
  assert.equal(useIde.getState().netCompiler, false);
  assert.equal(useIde.getState().trailThinkH, 312);
  assert.equal(useBrain.getState().autoUpdate, false);
  assert.equal(useBrain.getState().helperProfiles[0].name, "Saved helper");
  assert.equal(useModelLib.getState().cacheBackend, "indexeddb");
  assert.ok(useIde.getState().llmProfiles.some((p) => p.name === "Keep local profile"));

  const beforeInvalid = clone(exportSettingsPack());
  for (const invalid of [
    { ide: { fontSize: 18, llmProfiles: null } },
    { ide: { fontSize: -100 } },
    { ide: { mcpServers: [{ id: "bad" }] } },
    { ide: { llmProvider: "unknown" } },
    { ide: { llmContext: 0 } },
    { ide: { inputMap: { left: { keys: [{}] } } } },
    { ide: { fontSize: 18 }, brain: { context: -1 } },
    { ide: { fontSize: 18 }, learn: { skills: [{ name: "broken" }] } },
    { v: 99, ide: { fontSize: 18 } }, null, [],
  ]) {
    assert.throws(() => applySettingsPack(invalid));
    assert.deepEqual(clone(exportSettingsPack()), beforeInvalid, "Invalid packs must not partly change any settings");
  }
  const old = clone(backup); old.v = 1; delete old.ide.llmAuthMode; delete old.ide.llmSlots;
  s.setLlmProvider("ollama", "key"); applySettingsPack(old);
  assert.equal(useIde.getState().llmAuthMode, "abo", "Legacy named profile recovers missing mode");
  s.setLlmProvider("ollama", "key");
  assert.throws(() => applySettingsPack({ v: 1, ide: { llmProvider: "anthropic", llmModel: "unknown" } }), /API-\/Abo-Modus/);
  assert.equal(useIde.getState().llmProvider, "ollama");
  applySettingsPack({ fontSize: 18 });
  assert.equal(useIde.getState().fontSize, 18, "Legacy flat settings still work");

  s.setLlmProvider("anthropic", "abo");
  s.setLlmContextAuto(false); s.setLlmContext(8192); s.setLlmThinking("high"); s.setLlmTemperature(0.7); s.setLlmMaxOut(4096);
  s.setLlmModel("claude-haiku-4-5");
  assert.deepEqual([useIde.getState().llmContextAuto, useIde.getState().llmContext, useIde.getState().llmThinking, useIde.getState().llmTemperature, useIde.getState().llmMaxOut], [false, 8192, "high", 0.7, 4096]);
  s.setLlmProvider("ollama", "key"); s.setLlmProvider("anthropic", "abo");
  assert.equal(useIde.getState().llmModel, "claude-haiku-4-5");
  assert.equal(useIde.getState().llmThinking, "high");
  s.setLlmContextAuto(true); s.setLlmModel("claude-sonnet-4-5");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(useIde.getState().llmContext, 200_000, "Auto context still follows a known model");
  assert.equal(useIde.getState().llmThinking, "high");

  const files = { "my-work.txt": "Keep ideas", ".anvil/board.json": "Keep board" };
  useIde.setState({ files, fontSize: 20, trailWidth: 480, mcpServers: [{ id: "saved-mcp", name: "Saved MCP", url: "http://localhost/mcp", enabled: true }] });
  useBrain.setState({ autoLoad: true, autoUpdate: false, useWorker: false, systemExtra: "custom helper", jobs: { ...useBrain.getState().jobs, attach: true } });
  useLearn.getState().addFact("user", "Keep this idea");
  const facts = clone(useLearn.getState().facts), profiles = clone(useIde.getState().llmProfiles);
  resetSettingsCategory("editor");
  assert.equal(useIde.getState().fontSize, 13);
  assert.equal(useIde.getState().trailWidth, 480, "Section reset leaves other categories alone");
  assert.equal(useIde.getState().llmProvider, "anthropic");
  resetAllSettings();
  assert.deepEqual(useIde.getState().files, files);
  assert.deepEqual(clone(useLearn.getState().facts), facts);
  assert.deepEqual(clone(useIde.getState().llmProfiles), profiles);
  assert.equal(useIde.getState().mcpServers[0].id, "saved-mcp");
  assert.equal(useIde.getState().llmProvider, "ollama");
  assert.equal(useIde.getState().llmApiKey, "fixture-local-secret");
  assert.equal(useBrain.getState().autoLoad, false);
  assert.equal(useBrain.getState().autoUpdate, true);
  assert.equal(useBrain.getState().useWorker, true);
  assert.equal(useBrain.getState().jobs.attach, false);
  assert.equal(useBrain.getState().systemExtra, "");
  assert.equal(useBrain.getState().helperProfiles[0].name, "Saved helper");
  assert.equal(useModelLib.getState().prefetchOnStart, false);
  assert.equal(requests.length, 0);
});

function assertNoIndexedDb(error) {
  assert.ok(error instanceof AggregateError);
  for (const cause of error.errors) assert.match(cause.message, /IndexedDB ist nicht verfügbar/);
}
