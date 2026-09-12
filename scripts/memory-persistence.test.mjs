import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";
import path from "node:path";

// Exercise the real persistence scheduler with an isolated archive adapter.
// No browser profile, workspace files or external service is touched.
test("memory persistence recovers complete state beyond localStorage", async t => {
  const values = new Map(), archive = new Map(), timers = new Set();
  let denyLocal = false, denyArchive = false;
  globalThis.memoryArchiveFixture = archive;
  globalThis.failMemoryArchiveFixture = () => denyArchive;
  globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem(k, v) { if (denyLocal) throw new Error("quota"); values.set(k, v); }, removeItem: k => values.delete(k) };
  globalThis.window = Object.assign(new EventTarget(), { localStorage, location: { pathname: "/" }, setTimeout(fn, ms) { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); return timer; }, clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); } });
  globalThis.document = new EventTarget();
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } }, server: { middlewareMode: true, hmr: false }, appType: "custom", plugins: [{ name: "archive-adapter", transform(code, id) {
    if (id.endsWith("/src/lib/persist-db.ts")) return `
      export async function saveArchive(name, next) { if (globalThis.failMemoryArchiveFixture()) throw new Error('archive unavailable'); globalThis.memoryArchiveFixture.set(name, structuredClone(next)); }
      export async function loadArchive(name) { const a = globalThis.memoryArchiveFixture.get(name) || {}; return { ...a, files: a.files ?? null, chat: a.chat ?? null, recovery: a.recovery ?? null }; }
      export async function removeArchive(name) { globalThis.memoryArchiveFixture.delete(name); }
    `;
    if (id.endsWith("/src/lib/intern.ts")) return "export function note() {}";
  } }] });
  const { idePersistStorage, flushPersistence } = await server.ssrLoadModule("/src/lib/persist-storage.ts");
  t.after(async () => {
    await flushPersistence().catch(() => {}); await new Promise(resolve => setImmediate(resolve)); await server.close();
    for (const timer of timers) clearTimeout(timer);
    delete globalThis.window; delete globalThis.document; delete globalThis.localStorage;
    delete globalThis.memoryArchiveFixture; delete globalThis.failMemoryArchiveFixture;
  });
  const storage = idePersistStorage();
  await storage.getItem("anvil-learn");
  const state = { facts: Array.from({ length: 70 }, (_, i) => ({ id: `f${i}`, text: `Fakt ${i}`, ws: "v2:path:c:/a" })), forgottenFacts: ['["","Vergessen"]'], skills: [], negs: [], prefs: { inject: false } };
  denyLocal = true;
  storage.setItem("anvil-learn", { state });
  await flushPersistence();
  assert.deepEqual(archive.get("anvil-learn").state, state);
  assert.equal(values.has("anvil-learn"), false);
  // Fresh module = browser restart, also discards the in-memory localStorage fallback.
  server.moduleGraph.invalidateAll();
  const fresh = await server.ssrLoadModule("/src/lib/persist-storage.ts");
  assert.deepEqual((await fresh.idePersistStorage().getItem("anvil-learn")).state, state);
  denyLocal = false;
  await storage.getItem("anvil-ide");
  const sessions = { "v2:path:c:/a": { chat: [{ id: "old", role: "user", content: "X".repeat(100000) }], sessionJournal: { goal: "Altes Projekt" } } };
  storage.setItem("anvil-ide", { state: { files: {}, chat: [], memoryWorkspace: "v2:path:d:/b", workspaceSessions: sessions } });
  await flushPersistence();
  assert.equal(JSON.parse(values.get("anvil-ide")).state.workspaceSessions, undefined);
  assert.deepEqual((await storage.getItem("anvil-ide")).state.workspaceSessions, sessions);
  await server.ssrLoadModule("/src/lib/intern.ts");
  denyArchive = true;
  storage.setItem("anvil-learn", { state: { ...state, facts: [] } });
  await assert.rejects(flushPersistence(), /Sicherung unvollständig/);
  denyArchive = false;
  await flushPersistence();
  assert.deepEqual(archive.get("anvil-learn").state.facts, []);
  await storage.removeItem("anvil-learn");
  assert.equal(archive.has("anvil-learn"), false);
});
