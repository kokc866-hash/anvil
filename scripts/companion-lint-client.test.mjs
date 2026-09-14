import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createServer } from "vite";

test("lint preserves server error details, fallback status and successful diagnostics", async (t) => {
  const server = await createServer({
    configFile: false, root: process.cwd(),
    resolve: { alias: { "@": path.resolve("src") } },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom",
  });
  const originalFetch = globalThis.fetch;
  t.after(async () => { globalThis.fetch = originalFetch; await server.close(); });
  const { companionLint } = await server.ssrLoadModule("/src/lib/companion.ts");
  const { lintSummary } = await server.ssrLoadModule("/src/lib/lint-summary.ts");
  const summary = lintSummary([{ name: "pyright", ok: false, status: "findings" }], 44);
  assert.equal(summary.ok, true);
  assert.match(summary.text, /Prüfung abgeschlossen · 44 Code-Meldungen/);
  assert.doesNotMatch(summary.text, /mit Fehler|fehlgeschlagen/);
  const failed = lintSummary([{ name: "pyright", ok: false, status: "failed", error: "Zeitlimit erreicht" }], 44);
  assert.equal(failed.ok, false);
  assert.match(failed.text, /Zeitlimit erreicht/);
  assert.equal(lintSummary([{ name: "pyright", ok: false }], 44).ok, false, "legacy status is not guessed from aggregate diagnostics");
  const files = [{ path: "probe.py", content: "x = 1" }];
  globalThis.fetch = async () => Response.json({ ok: false, error: "Error: spawn EINVAL" }, { status: 400 });
  assert.equal((await companionLint(files)).error, "Error: spawn EINVAL");
  globalThis.fetch = async () => new Response("Unavailable", { status: 503 });
  assert.equal((await companionLint(files)).error, "HTTP 503");
  globalThis.fetch = async () => Response.json({}, { status: 401 });
  assert.equal((await companionLint(files)).error, "Token");
  const success = { ok: true, diagnostics: [{ path: "probe.py", line: 1, message: "type mismatch" }], tools: [{ name: "pyright", ok: false }] };
  globalThis.fetch = async () => Response.json(success);
  assert.deepEqual(await companionLint(files), success);
});
