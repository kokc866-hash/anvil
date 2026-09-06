/** Exercise the minified production runtime, including serialized functions and lazy TS compiler. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const origin = "http://127.0.0.1:8190";
const server = spawn(process.execPath, [".output/server/index.mjs"], {
  env: { ...process.env, PORT: "8190", HOST: "127.0.0.1", NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (data) => {
  serverLog = (serverLog + data).slice(-8000);
});
server.stderr.on("data", (data) => {
  serverLog = (serverLog + data).slice(-8000);
});
let browser;
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (server.exitCode !== null) throw new Error("Production server failed: " + serverLog);
    try {
      ready = (await fetch(origin)).ok;
    } catch {
      /* booting */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, serverLog);
  browser = await chromium.launch({
    executablePath: process.env.ANVIL_CHROMIUM_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--no-zygote",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (window === window.top)
      localStorage.setItem(
        "anvil-ide",
        JSON.stringify({
          state: { setupDone: true, autoUpdate: false, runInWindow: false, runPopout: false },
          version: 0,
        }),
      );
  });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__anvilIde?.persist?.hasHydrated());
  await page.evaluate(() => {
    window.__anvilIde.setState({
      files: {
        "index.html":
          '<!doctype html><html><head><script type="module" src="src/main.ts"></script></head><body style="margin:0"><h1>Canvas Release</h1><canvas id="game"></canvas></body></html>',
        "src/main.ts":
          'import {value} from "./value.ts";window.answer=value;window.g=Anvil.run({canvas:"game",width:320,height:200,draw(){this.clear("#234");this.text("Release bereit",20,20,"white",24)}});',
        "src/value.ts": "enum Answer {Correct=42};export const value: number = Answer.Correct;",
      },
      activePath: "index.html",
      runPath: "index.html",
      openPaths: ["index.html"],
      previewOpen: true,
      output: [],
    });
    window.dispatchEvent(new Event("anvil-run"));
  });
  await page.waitForFunction(() => window.__anvilIde.getState().output.length > 0);
  const run = await page.evaluate(() => {
    const r = window.__anvilIde.getState().output.at(-1);
    return { ok: r.ok, error: r.stderr, session: r.stage?.id };
  });
  assert.ok(run.ok, run.error);
  const guest = page.frames().find((frame) => frame.url() === "about:srcdoc");
  assert.ok(guest);
  assert.deepEqual(await guest.evaluate(() => ({ answer: window.answer, state: window.g.state })), {
    answer: 42,
    state: "running",
  });
  const boot = await guest.evaluate(() => window.__ANVIL_SESSION__);
  const capture = await page.evaluate(
    (boot) =>
      new Promise((resolve) => {
        const el = document.querySelector('iframe[title="Vorschau"]'),
          request = crypto.randomUUID();
        const timer = setTimeout(() => {
          window.removeEventListener("message", listener);
          resolve({ ok: false, error: "shot timeout" });
        }, 12000);
        function listener(event) {
          if (event.source === el.contentWindow && event.data?.request === request) {
            clearTimeout(timer);
            window.removeEventListener("message", listener);
            resolve({
              ok: event.data.ok,
              error: event.data.error,
              bytes: event.data.image?.length,
            });
          }
        }
        window.addEventListener("message", listener);
        el.contentWindow.postMessage(
          {
            channel: "anvil-canvas-v2",
            session: boot.session,
            revision: boot.revision,
            request,
            op: "shot",
          },
          "*",
        );
      }),
    boot,
  );
  assert.ok(capture.ok && capture.bytes > 1000, capture.error);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await guest.waitForFunction(() => window.g.paused === true);
  assert.equal(await guest.evaluate(() => window.g.paused), true);
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await guest.waitForFunction(() => window.g.paused === false);
  assert.equal(await guest.evaluate(() => window.g.paused), false);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  assert.ok(
    await page
      .locator('iframe[title="Vorschau"]')
      .contentFrame()
      .getByText("Gestoppt. Run startet neu.")
      .isVisible(),
  );
  assert.deepEqual(errors, []);
  console.log("CANVAS_PRODUCTION_MODULES_RUNTIME_CAPTURE_PAUSE_STOP_OK");
} finally {
  await browser?.close();
  server.kill();
}
