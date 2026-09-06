/** Targeted Canvas regression: real project loader, iframe, input, run tools and popout. No model/API calls. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

const server = await createServer({
  server: { host: "127.0.0.1", port: 8188, strictPort: true },
  cacheDir: "node_modules/.vite-canvas",
});
await server.listen();
let browser;
const passed = [];
const check = (name, value = true) => {
  assert.ok(value, name);
  passed.push(name);
  console.log("PASS " + name);
};
const source = `window.events=[];window.confirmed=0;window.up=0;window.moves=0;
window.addEventListener('keydown',e=>window.events.push(e.key));
window.g=Anvil.run({canvas:'game',width:320,height:200,
update(dt){if(this.input.ok)window.confirmed++;if(this.input.up)window.up++;if(this.input.left)window.moves++;},
draw(){this.clear('#243448');this.text('Canvas bereit',16,24,'white',24);}});`;
const files = {
  "index.html":
    '<!doctype html><html><head><script src="game.js" defer></script></head><body style="margin:0;background:#243448;color:white"><button id="menu">Menü</button><canvas id="game"></canvas></body></html>',
  "game.js": source,
};
try {
  browser = await chromium.launch({
    executablePath: process.env.ANVIL_CHROMIUM_PATH || undefined,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--no-zygote",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().includes("/monaco/"))
      console.log("MONACO_RESOURCE", response.status(), response.url());
  });
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
  await page.goto("http://127.0.0.1:8188/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__anvilIde?.persist?.hasHydrated());
  async function fixture(next, path = "index.html") {
    await page.evaluate(
      ({ files, path }) =>
        window.__anvilIde.setState({
          files,
          activePath: path,
          runPath: path,
          openPaths: [path],
          previewOpen: true,
          runInWindow: false,
          runPopout: false,
          output: [],
          agentBusy: false,
        }),
      { files: next, path },
    );
    await page.locator('iframe[title="Vorschau"]').waitFor();
  }
  async function run() {
    return page.evaluate(async () => {
      const { runFile } = await import("/src/lib/run-client.ts");
      const s = window.__anvilIde.getState();
      const r = await runFile(s.runPath || s.activePath, s.files);
      return { ok: r.ok, error: r.stderr, session: r.stage?.id, state: r.stage?.state };
    });
  }
  async function shot() {
    return page.evaluate(async () => {
      const { shotLoop } = await import("/src/lib/run-loop.ts");
      return shotLoop();
    });
  }
  async function play(keys) {
    return page.evaluate(async (keys) => {
      const { playLoop } = await import("/src/lib/run-loop.ts");
      return playLoop(keys, 70);
    }, keys);
  }
  const guest = () =>
    page.frames().find((f) => f !== page.mainFrame() && f.url() === "about:srcdoc");

  await fixture(files);
  if (!process.argv.includes("--popout-only")) {
    const first = await run();
    check("deferred project script starts after body and engine", first.ok);
    check(
      "visible instance is used, with no hidden loop iframe",
      (await page.locator("iframe").count()) === 1 &&
        (await page.locator("#anvil-loop-frame").count()) === 0,
    );
    const captured = await shot();
    check(
      "HTML plus Canvas can be captured",
      captured.ok && captured.image?.startsWith("data:image/png") && captured.image.length > 1000,
    );
    const played = await play(["ok"]);
    check("play confirms delivery", played.ok);
    assert.deepEqual(
      await guest().evaluate(() => ({
        confirmed: window.confirmed,
        up: window.up,
        enter: window.events.includes("Enter"),
      })),
      { confirmed: 1, up: 0, enter: true },
    );
    check("ok is Enter and ordinary keydown handlers receive it");
    check(
      "literal space is not removed",
      (await play([" "])).ok && (await guest().evaluate(() => window.events.includes(" "))),
    );
    const custom = await page.evaluate(async () => {
      const { DEFAULT_INPUT_MAP } = await import("/src/lib/input-map.ts");
      return { ...DEFAULT_INPUT_MAP, left: { keys: ["q"], pad: [14] } };
    });
    await page.evaluate((map) => window.__anvilIde.getState().setInputMap(map), custom);
    await run();
    check(
      "custom bindings reach the live game",
      (await play(["left"])).ok &&
        (await guest().evaluate(() => window.events.includes("q") && window.moves > 0)),
    );

    const input = await guest().evaluate(() => {
      const canvas = window.g.canvas;
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA" }));
      const code = window.g.key.down("KeyA") && window.g.key.pressed("KeyA");
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "a", code: "KeyA" }));
      const field = document.createElement("input");
      document.body.append(field);
      field.focus();
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "w", code: "KeyW", bubbles: true }));
      const typing = !window.g.input.up;
      field.remove();
      canvas.focus();
      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { buttons: 2, clientX: 2, clientY: 2, pointerId: 1 }),
      );
      canvas.dispatchEvent(
        new PointerEvent("pointerup", { buttons: 0, clientX: 2, clientY: 2, pointerId: 1 }),
      );
      return { code, typing, released: !window.g.mouse.right && !window.g.mouse.down };
    });
    check("key/code, text fields and right mouse release", Object.values(input).every(Boolean));

    const runtime = await guest().evaluate(() => {
      window.g.dispose(false);
      const canvas = document.createElement("canvas"),
        container = document.createElement("div");
      container.style.cssText = "width:400px;height:200px";
      document.body.append(container);
      container.append(canvas);
      const g = Anvil.create({ canvas, width: 200, height: 100, pixel: true });
      g.resize(220, 110);
      const smooth = !g.ctx.imageSmoothingEnabled;
      const font = g.measure("MMMM", 24) > g.measure("MMMM", 12) * 1.8;
      let bounded = false;
      try {
        g.grid(-1);
      } catch {
        bounded = true;
      }
      g.ctx.globalAlpha = 0.7;
      try {
        g.alpha(0.1, () => {
          throw Error("alpha fixture");
        });
      } catch {}
      const alpha = Math.abs(g.ctx.globalAlpha - 0.7) < 0.01;
      const raf = window.requestAnimationFrame,
        cancel = window.cancelAnimationFrame;
      let fn;
      window.requestAnimationFrame = (f) => {
        fn = f;
        return 1234;
      };
      window.cancelAnimationFrame = () => {};
      g.timeScale = 0;
      const start = performance.now();
      g.start();
      fn(start + 100);
      const clock = g.time === 0 && g.dt === 0 && g.fps === 10;
      let calls = 0;
      g.update = () => {
        calls++;
        throw Error("fixture-update-failure");
      };
      g.timeScale = 1;
      fn(start + 116);
      const failed = g.state === "failed" && calls === 1;
      g.dispose();
      window.requestAnimationFrame = raf;
      window.cancelAnimationFrame = cancel;
      const glCanvas = document.createElement("canvas");
      document.body.append(glCanvas);
      const gl = Anvil.create({ canvas: glCanvas, gl: true });
      const webgl = !!gl.gl && gl.ctx === null;
      gl.dispose();
      return { smooth, font, bounded, alpha, clock, failed, webgl };
    });
    check(
      "real renderer: resize, fonts, bounds, alpha, zero-time, FPS, failures and WebGL",
      Object.values(runtime).every(Boolean),
    );
    await run();
    const attach = await guest().evaluate(async () => {
      window.g.dispose(false);
      const canvas = document.createElement("canvas");
      document.body.append(canvas);
      const h = Anvil.attach(canvas);
      canvas.focus();
      const original = navigator.getGamepads.bind(navigator);
      Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: () => [{ axes: [0, 0, 0, 0], buttons: [{ pressed: true }] }],
      });
      canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA", bubbles: true }));
      const first = await new Promise((r) =>
        requestAnimationFrame(() =>
          r({ pressed: h.key.pressed("KeyA"), pad: h.pad.connected && h.pad.a }),
        ),
      );
      await new Promise((r) => setTimeout(r, 20));
      const cleared = !h.key.pressed("KeyA");
      h.dispose();
      const again = Anvil.attach(canvas);
      const renewed = again !== h;
      again.dispose();
      Object.defineProperty(navigator, "getGamepads", { configurable: true, value: original });
      return { ...first, cleared, renewed };
    });
    check(
      "standalone attach ticks, clears edges, polls gamepads and can be recreated",
      Object.values(attach).every(Boolean),
    );

    await run();
    await guest().evaluate(() => {
      localStorage.setItem("level", "3");
      sessionStorage.setItem("level", "session");
      window.confirmed = 99;
    });
    const restarted = await run();
    check("Run always creates a new session", restarted.ok && restarted.session !== first.session);
    assert.deepEqual(
      await guest().evaluate(() => ({
        count: window.confirmed,
        local: localStorage.getItem("level"),
        session: sessionStorage.getItem("level"),
      })),
      { count: 0, local: "3", session: "session" },
    );
    check("restart resets JavaScript and preserves separate project stores");
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    check(
      "Stop terminates the entire document",
      await page
        .locator('iframe[title="Vorschau"]')
        .contentFrame()
        .getByText("Gestoppt. Run startet neu.")
        .isVisible(),
    );
    check("a stopped document rejects play", !(await play(["ok"])).ok);
    check("Run restarts a stopped document", (await run()).ok);

    const responsive = await guest().evaluate(async () => {
      const container = document.createElement("div");
      container.style.cssText = "width:400px;height:200px";
      document.body.append(container);
      const canvas = document.createElement("canvas");
      container.append(canvas);
      const second = Anvil.create({ canvas, width: 200, height: 100 });
      container.style.width = "200px";
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
      const fitted = Math.round(canvas.getBoundingClientRect().width) === 200;
      canvas.focus();
      canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "q", code: "KeyQ", bubbles: true }));
      const isolated = second.key.down("q") && !window.g.key.down("q");
      second.dispose(false);
      window.g.canvas.focus();
      window.g.canvas.dispatchEvent(
        new KeyboardEvent("keydown", { key: "q", code: "KeyQ", bubbles: true }),
      );
      const alive = window.g.key.down("q");
      window.g.canvas.dispatchEvent(
        new KeyboardEvent("keyup", { key: "q", code: "KeyQ", bubbles: true }),
      );
      container.remove();
      return { fitted, isolated, alive };
    });
    check(
      "container resize and independent canvas focus/disposal",
      Object.values(responsive).every(Boolean),
    );
    const interrupted = await page.evaluate(async () => {
      const { beginAgent, abortAgent } = await import("/src/lib/abort.ts");
      const { playLoop } = await import("/src/lib/run-loop.ts");
      beginAgent();
      window.__anvilIde.setState({ agentBusy: true });
      const task = playLoop(["q", "never-deliver"], 400);
      setTimeout(() => abortAgent("Canvas QA"), 200);
      const result = await task;
      window.__anvilIde.setState({ agentBusy: false });
      beginAgent();
      return result.ok;
    });
    check(
      "abort stops the sequence and releases the held key",
      interrupted === false &&
        (await guest().evaluate(
          () => !window.g.key.down("q") && !window.events.includes("never-deliver"),
        )),
    );

    const changed = {
      ...files,
      "game.js": source
        .replace("Canvas bereit", "Aktueller Code")
        .replace("'#243448'", "'#563421'"),
    };
    await page.evaluate((files) => window.__anvilIde.setState({ files }), changed);
    const current = await page.evaluate(async () => {
      const { previewFor } = await import("/src/lib/preview-doc.ts");
      const { shotLoop } = await import("/src/lib/run-loop.ts");
      const s = window.__anvilIde.getState();
      const view = await previewFor(
        "index.html",
        s.files["index.html"],
        s.files,
        undefined,
        s.inputMap,
        true,
      );
      return shotLoop(view.srcDoc);
    });
    check(
      "see_run loads changed code instead of returning a stale frame",
      current.ok && current.revision !== captured.revision && current.image !== captured.image,
    );

    await fixture({ ...files, "game.js": 'throw new Error("fixture-start-failure")' });
    const broken = await run();
    check(
      "startup failure returns ok:false with the actual error",
      !broken.ok && broken.error.includes("fixture-start-failure"),
    );
    await fixture({
      "index.html":
        '<html><head><script type="module" src="src/main.ts"></script></head><body><canvas id="game"></canvas></body></html>',
      "src/main.ts":
        'import {value} from "./value.ts"; window.answer=value; window.g=Anvil.run({canvas:"game",draw(){this.clear()}});',
      "src/value.ts": "export const value: number = 42;",
    });
    check(
      "relative TypeScript modules execute in the actual sandbox",
      (await run()).ok && (await guest().evaluate(() => window.answer === 42)),
    );
  }
  await fixture(files);
  await run();
  const popupEvent = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Run-Fenster", exact: true }).last().click();
  const popup = await popupEvent;
  await popup.waitForFunction(() => !!window.__anvilIde?.getState().files["index.html"]);
  await popup.locator('iframe[title="Vorschau"]').waitFor();
  const remote = await play(["ok"]);
  console.log(
    "POPUP_RESULT",
    JSON.stringify({ ok: remote.ok, error: remote.error, state: remote.state }),
  );
  check("agent reaches the separate Run window", remote.ok);
  const popupFrame = popup
    .frames()
    .find((f) => f !== popup.mainFrame() && f.url() === "about:srcdoc");
  check(
    "the visible popup received the confirmed key",
    await popupFrame.evaluate(() => window.confirmed === 1 && window.events.includes("Enter")),
  );
  await popup.close();
  await page.evaluate(() => window.__anvilIde.setState({ previewOpen: false, runPopout: false }));
  check("closed output cannot produce a false successful play", !(await play(["left"])).ok);

  await fixture(files);
  await run();
  const screenshots = process.env.ANVIL_SCREENSHOT_DIR || join(tmpdir(), "anvil-canvas-qa");
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: join(screenshots, "anvil-canvas-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(screenshots, "anvil-canvas-mobile.png") });
  console.log(JSON.stringify({ ok: true, checks: passed.length }));
} finally {
  await browser?.close();
  await server.close();
}
