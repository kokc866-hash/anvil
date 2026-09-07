/** Desktop integration of the reported failures. Local service responses are controlled; no model is loaded. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const production = process.argv.includes("--production");
const base = process.env.ANVIL_TEST_ORIGIN || (production ? "http://127.0.0.1:8081" : "http://127.0.0.1:8080");
const kind = production ? "production" : "desktop";
const screenshots = "/workspace/screenshots/anvil-reported-problems";
await mkdir(screenshots, { recursive: true });
// Run the server in the same execution context as Chromium (some runners isolate sockets per job).
const server = process.env.ANVIL_TEST_START ? spawn("npm", ["run", production ? "preview" : "dev", "--", "--host", "127.0.0.1", "--port", new URL(base).port], { env: { ...process.env, ANVIL_ELECTRON_BUILD: "1" }, detached: true, stdio: ["ignore", "pipe", "pipe"] }) : null;
let serverLog = "";
server?.stdout.on("data", (v) => { serverLog = (serverLog + v).slice(-6000); });
server?.stderr.on("data", (v) => { serverLog = (serverLog + v).slice(-6000); });
let browser, page;
try {
  if (server) {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { ready = (await fetch(base)).ok; } catch { /* starting */ }
      if (ready) break;
      if (server.exitCode !== null) throw new Error(serverLog);
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(ready, serverLog);
  }
  browser = await chromium.launch({ executablePath: process.env.ANVIL_CHROMIUM_PATH || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  page = await browser.newPage({ viewport: { width: 1500, height: 960 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let root = "/application", registrations = 0, writeFailure = false;
  const disk = {};
  await page.exposeFunction("fixtureEnsure", () => { root = "/application"; return { ok: true, token: "fixture-token" }; });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === base && url.pathname === "/python-check-worker.js") {
      return route.fulfill({ contentType: "application/javascript", body: 'self.onmessage=({data})=>setTimeout(()=>self.postMessage({id:data.id,hits:data.files.filter(f=>f.content.includes("if True\\n")).map(f=>({path:f.path,line:1,col:8,message:"expected colon"}))}),100);' });
    }
    if (url.origin === base || ["data:", "blob:"].includes(url.protocol)) return route.continue();
    let value = { ok: true, diagnostics: [], tools: [], data: [], models: [] };
    if (url.origin === "http://127.0.0.1:7845") {
      const body = route.request().method() === "POST" ? route.request().postDataJSON() : {};
      if (url.pathname === "/v1/workspace") { root = body.cwd; registrations++; value = { ok: true, cwd: root }; }
      if (url.pathname === "/v1/file") {
        if (body.cwd !== root) value = { ok: false, error: "cwd außerhalb des Workspace" };
        else if (writeFailure) value = { ok: false, error: "Zugriff verweigert: " + body.path };
        else { disk[body.path] = body.content; value = { ok: true, path: body.path }; }
      }
    }
    if (route.request().resourceType() === "script") return route.fulfill({ contentType: "application/javascript", body: "" });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(value) });
  });
  await page.addInitScript(() => {
    if (window !== window.top) return;
    localStorage.setItem("anvil-ide", JSON.stringify({ state: { setupDone: true, autoUpdate: false, autoHw: false, autoSaveDisk: false, formatOnSave: false, liveRun: false, autoRunAgent: false, suggestOn: false, mcpServers: [], files: { "README.md": "Fixture" }, openPaths: [], activePath: null, workspaceCwd: "", companionKeep: false }, version: 0 }));
    localStorage.setItem("anvil-brain", JSON.stringify({ state: { on: false, autoLoad: false, autoUpdate: false, autonomy: "off" }, version: 0 }));
    window.anvilNative = {
      onBeforeClose: (fn) => { window.fixtureClose = fn; return () => {}; },
      companionEnsure: () => window.fixtureEnsure(), companionRelease: async () => {}, companionIdle: async () => {},
      secretsLoad: () => null,
      secretsSave: async (secrets) => { if (window.failSecrets) throw new Error("Schlüsselspeicher gesperrt"); return { persistent: true, revision: Date.now(), secrets }; },
      saveRecovery: async (snapshot) => { window.recoverySnapshot = snapshot; return { path: "I:\\Sicherung\\Anvil-Sicherung-test" }; },
    };
  });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated() && window.fixtureClose);
  const ts = 'export const canvas = document.createElement("canvas") as HTMLCanvasElement; const ctx: CanvasRenderingContext2D = canvas.getContext("2d")!; const dict: Record<string, HTMLImageElement> = {}; const a: [number,number][] = [[1,2]]; a.some(x=>x[0]); a.shift();';
  await page.evaluate((source) => {
    const store = window.__anvilIde;
    store.setState({ autoSaveDisk: false, formatOnSave: false, suggestOn: false, workspaceCwd: "", files: {}, dirty: {}, pendingDiffs: [] });
    store.getState().applyFiles({
      "tsconfig.json": '{"compilerOptions":{"lib":["ES2022"]}}',
      "snake/tsconfig.json": '{"compilerOptions":{"lib":["ES2017","DOM"]},"include":["snake.ts"]}',
      "snake/snake.ts": source + ' const wrong: number = "bad";',
      "snake/snake.py": "if True\n    pass\n",
      "Snake.java": "import java.util.LinkedList;\nclass Snake {}",
    });
    store.getState().openFile("snake/snake.ts");
    store.getState().revealOutput();
    store.getState().addChat({ role: "assistant", content: "**Warnung bleibt sichtbar.** Der Run prüft `snake.ts`." });
    window.dispatchEvent(new Event("anvil-problems"));
  }, ts);
  await page.waitForFunction(() => window.__anvilIde.getState().compileProblems.some((p) => p.source === "tsc") && window.__anvilIde.getState().compileProblems.some((p) => p.source === "py"), undefined, { timeout: 30000 });
  const problems = await page.evaluate(() => window.__anvilIde.getState().lspProblems);
  assert.equal(problems.filter((p) => p.source === "tsc").length, 1, JSON.stringify(problems));
  assert.equal(problems.some((p) => ["python", "syntax"].includes(p.source) && p.path.endsWith(".py")), false, "authoritative Python results suppress heuristics even when Python finishes before TS");
  await page.getByRole("button", { name: /^Probleme/ }).first().click();
  const warning = page.getByRole("button", { name: /Snake.java:1 · Warnung/ });
  await warning.waitFor();
  assert.ok((await warning.getAttribute("class")).includes("text-warning"));
  await page.locator(".chat-markdown strong").filter({ hasText: "Warnung bleibt sichtbar." }).waitFor();
  await page.screenshot({ path: `${screenshots}/${kind}-diagnostics.png` });
  await page.evaluate((source) => { const s = window.__anvilIde.getState(); s.setContent("snake/snake.ts", source); s.setContent("snake/snake.py", "if True: pass\n"); }, ts);
  await page.waitForFunction(() => !window.__anvilIde.getState().lspProblems.some((p) => p.severity === "error"));

  await page.evaluate(() => {
    const st = window.__anvilIde;
    const content = st.getState().files["snake/snake.ts"];
    st.setState({ workspaceCwd: "I:\\AnvilTest\\tests", dirty: { "snake/snake.ts": true }, pendingDiffs: [{ path: "snake/snake.ts", before: "before", after: content, source: "round", existedBefore: true, backupVersion: 2 }] });
    window.closeResult = undefined; window.fixtureClose().then((ok) => { window.closeResult = ok; });
  });
  await page.getByRole("dialog", { name: "Ungespeicherte Änderungen" }).getByRole("button", { name: "Speichern", exact: true }).click();
  await page.waitForFunction(() => window.closeResult === true);
  assert.ok(registrations > 0);
  assert.equal(disk["snake/snake.ts"], ts);
  assert.equal(await page.evaluate(() => Boolean(window.__anvilIde.getState().dirty["snake/snake.ts"])), false);

  writeFailure = true;
  await page.evaluate(() => {
    const st = window.__anvilIde; st.setState({ pendingDiffs: [] });
    st.getState().setContent("snake/snake.ts", st.getState().files["snake/snake.ts"] + "\n// edited");
    window.closeResult = undefined; window.fixtureClose().then((ok) => { window.closeResult = ok; });
  });
  await page.getByRole("dialog", { name: "Ungespeicherte Änderungen" }).getByRole("button", { name: "Speichern", exact: true }).click();
  const failure = page.getByRole("dialog", { name: "Beenden: Speichern fehlgeschlagen" });
  await failure.getByText(/Zugriff verweigert: snake\/snake.ts/).waitFor();
  await page.screenshot({ path: `${screenshots}/${kind}-save-failure.png` });
  writeFailure = false;
  await failure.getByRole("button", { name: "Erneut versuchen" }).click();
  await page.waitForFunction(() => window.closeResult === true);
  assert.match(disk["snake/snake.ts"], /edited/);

  await page.evaluate(() => {
    window.failSecrets = true; window.__anvilIde.getState().setLlmApiKey("fixture-not-a-real-key");
    window.closeResult = undefined; window.fixtureClose().then((ok) => { window.closeResult = ok; });
  });
  await failure.getByText(/Schlüsselspeicher gesperrt/).waitFor();
  await failure.getByRole("button", { name: "Sicherung erstellen" }).click();
  await page.getByRole("dialog", { name: "Projektsicherung erstellt" }).getByRole("button", { name: "Beenden", exact: true }).click();
  await page.waitForFunction(() => window.closeResult === true);
  assert.equal(await page.evaluate(() => window.recoverySnapshot.files["snake/snake.ts"]), disk["snake/snake.ts"]);
  const svg = '<svg width="12" height="12"><rect width="12" height="12" fill="#669988"/></svg>';
  await page.evaluate((source) => {
    const store = window.__anvilIde;
    const html = '<!doctype html><html><body><canvas id="image-test" width="40" height="40"></canvas><script>Promise.all([Anvil.loadImage(' + JSON.stringify("data:image/svg+xml," + source) + '),Anvil.loadImage("sprite.svg")]).then(images=>{window.imageWidths=images.map(i=>i.naturalWidth);document.getElementById("image-test").getContext("2d").drawImage(images[0],0,0);});</script></body></html>';
    store.setState({ workspaceCwd: "", pendingDiffs: [], dirty: {}, files: { "index.html": html, "sprite.svg": source }, activePath: "index.html", runPath: "index.html", openPaths: ["index.html"], previewOpen: true, runInWindow: false, runPopout: false, output: [] });
    window.dispatchEvent(new Event("anvil-run"));
  }, svg);
  await page.waitForFunction(() => window.__anvilIde.getState().output.length > 0);
  const run = await page.evaluate(() => window.__anvilIde.getState().output.at(-1));
  assert.ok(run.ok, run.stderr);
  const guest = page.frames().find((frame) => frame.url() === "about:srcdoc");
  assert.ok(guest);
  await guest.waitForFunction(() => window.imageWidths);
  assert.deepEqual(await guest.evaluate(() => window.imageWidths), [12, 12]);
  const invalid = await guest.evaluate(async () => { try { await Anvil.loadImage("data:image/svg+xml,%3Csvg%3E%3Cbroken%3E%3C/svg%3E"); return "unexpected success"; } catch (e) { return e.message; } });
  assert.match(invalid, /gültiges XML/);
  assert.deepEqual(errors, []);
  console.log(`${kind.toUpperCase()}_DIAGNOSTICS_SAVE_RETRY_RECOVERY_OK`);
} catch (error) {
  await page?.screenshot({ path: `${screenshots}/${kind}-failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  if (server) { try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill(); } }
}
