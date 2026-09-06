import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";
import path from "node:path";

test("secret writes deduplicate, preserve failed migrations and report a redacted cause", async (t) => {
  const values = new Map([["anvil-secrets", JSON.stringify({ llmApiKey: "fixture-private-key", keys: { openai: "fixture-private-key" } })]]);
  globalThis.localStorage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) };
  let calls = 0;
  let fail = true;
  let state = { ok: true, persistent: true, browserMigrated: false, revision: 0, secrets: { llmApiKey: "", githubToken: "", companionToken: "", keys: {}, vault: [] } };
  globalThis.window = Object.assign(new EventTarget(), { setTimeout, clearTimeout, anvilNative: {
    secretsLoad: () => state,
    secretsSave: async (patch, options) => {
      calls++;
      if (fail) throw new Error("Schlüsselzugriff nicht erlaubt. fixture-private-key");
      state = { ...state, revision: state.revision + 1, browserMigrated: options.migrate, secrets: { ...state.secrets, ...patch, keys: { ...state.secrets.keys, ...patch.keys } } };
      return state;
    },
  } });
  globalThis.document = new EventTarget();
  globalThis.fixtureSecretNotes = [];
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } }, server: { middlewareMode: true, hmr: false }, appType: "custom",
    plugins: [{ name: "secret-diagnostic-sink", enforce: "pre", transform(_code, id) {
      if (id.endsWith("/src/lib/intern.ts")) return 'export function note(kind, message) { globalThis.fixtureSecretNotes.push({kind, message}); }';
    } }],
  });
  t.after(async () => { await server.close(); delete globalThis.localStorage; delete globalThis.window; delete globalThis.document; delete globalThis.fixtureSecretNotes; });
  await server.ssrLoadModule("/src/lib/intern.ts");
  const { loadSecrets, saveSecrets, flushSecrets, secretStorageStatus } = await server.ssrLoadModule("/src/lib/secrets.ts");
  assert.equal(loadSecrets().llmApiKey, "fixture-private-key");
  await assert.rejects(flushSecrets(), /nicht erlaubt/);
  assert.ok(values.has("anvil-secrets"), "failed migration must keep the original browser data");
  assert.match(secretStorageStatus(), /Schlüsselzugriff nicht erlaubt/);
  assert.equal(secretStorageStatus().includes("fixture-private-key"), false);
  for (let i = 0; i < 20; i++) saveSecrets({ llmApiKey: "fixture-private-key" });
  assert.equal(calls, 1);
  fail = false;
  await flushSecrets();
  assert.equal(calls, 2, "a pending failed write remains retryable even when its value is unchanged");
  assert.equal(values.has("anvil-secrets"), false);
  assert.match(secretStorageStatus(), /verschlüsselt/);
  saveSecrets({ companionToken: "companion-fixture" });
  await flushSecrets();
  for (let i = 0; i < 20; i++) saveSecrets({ companionToken: "companion-fixture" });
  await flushSecrets();
  assert.equal(calls, 3);
  assert.equal(state.secrets.keys.openai, "fixture-private-key");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(globalThis.fixtureSecretNotes.length, 1);
  assert.match(globalThis.fixtureSecretNotes[0].message, /nicht erlaubt/);
  assert.equal(globalThis.fixtureSecretNotes[0].message.includes("fixture-private-key"), false);
});
