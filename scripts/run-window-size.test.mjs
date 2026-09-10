import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const bridgeSource = stripTypeScriptTypes(readFileSync("src/lib/canvas/bridge.ts", "utf8"));
const { installCanvasBridge } = await import(`data:text/javascript;base64,${Buffer.from(bridgeSource).toString("base64")}`);

test("ready reports logical output dimensions, surrounding controls and margins once", async () => {
  const rect = { left: 100, top: 100, right: 580, bottom: 400, width: 480, height: 300 };
  const canvas = { tagName: "CANVAS", children: [], style: {}, width: 1600, height: 1000, _cssW: 800, _cssH: 500, getBoundingClientRect: () => rect };
  const button = { tagName: "BUTTON", children: [], getBoundingClientRect: () => ({ left: 100, top: 80, right: 160, bottom: 100, width: 60, height: 20 }) };
  const sent = [];
  const win = Object.assign(new EventTarget(), {
    __ANVIL_SESSION__: { session: "test", revision: "one", local: {}, storage: {} },
    parent: { postMessage: (data) => sent.push(data) },
    console: { log() {}, warn() {}, error() {} },
    document: { readyState: "complete", images: [], body: { querySelectorAll: () => [canvas, button] } },
    getComputedStyle: () => ({ marginLeft: "8px", marginRight: "8px", marginTop: "8px", marginBottom: "8px" }),
    requestAnimationFrame: (fn) => queueMicrotask(fn),
  });
  const runtime = { ready: async () => {}, status: () => ({ state: "running" }), dispose() {} };
  const bridge = installCanvasBridge(win, { dispose() {} }, runtime);
  await bridge.ready;
  assert.deepEqual(sent.at(-1).outputSize, { width: 816, height: 536 });
  rect.width = 1000; rect.height = 700;
  assert.deepEqual(bridge.status().outputSize, { width: 816, height: 536 }, "manual resizing never feeds back into preferred size");
  assert.equal(bridge.status().state, "running");
  bridge.dispose();
});

test("native fitting includes window chrome, stays on its monitor and rejects other senders", () => {
  const handlers = new Map();
  let fitted;
  const content = { width: 944, height: 601 };
  const bounds = { x: 3400, y: 700, width: 960, height: 640 };
  class BrowserWindow {
    constructor() { this.id = 1; this.webContents = { mainFrame: { url: "http://127.0.0.1:8080/run" }, setBackgroundThrottling() {}, setWindowOpenHandler() {} }; }
    setMenuBarVisibility() {} once() {} on() {} loadURL() {} isDestroyed() { return false; }
    isMaximized() { return false; } isFullScreen() { return false; }
    getBounds() { return bounds; } getContentBounds() { return content; }
    setBounds(next) { fitted = next; }
  }
  let child;
  const Original = BrowserWindow;
  const Factory = class extends Original { constructor(...args) { super(...args); child = this; } };
  const source = readFileSync("electron/child.mjs", "utf8").replace(/^import .*;\n/gm, "").replace("export function bindChildWindows", "function bindChildWindows");
  const bind = new Function("BrowserWindow", "screen", "handleOnce", "anvilWebPrefs", "appOrigin", `${source}; return bindChildWindows;`)(Factory,
    { getDisplayMatching: () => ({ workArea: { x: 1920, y: 0, width: 1920, height: 1040 } }) },
    (name, fn) => handlers.set(name, fn), () => ({}), () => url => url.startsWith("http://127.0.0.1:8080/"));
  const manager = bind({ port: 8080 }); manager.createChild("/run");
  const fit = handlers.get("child-fit-run");
  const event = { sender: child.webContents, senderFrame: child.webContents.mainFrame };
  assert.equal(fit(event, { width: 1200, height: 700 }), true);
  assert.deepEqual(fitted, { width: 1216, height: 739, x: 2624, y: 301 });
  assert.equal(fit(event, { width: 10000, height: 10000 }), true);
  assert.deepEqual(fitted, { width: 1920, height: 1040, x: 1920, y: 0 });
  assert.equal(fit({ ...event, senderFrame: {} }, { width: 800, height: 600 }), false);
  assert.equal(fit({ ...event, sender: {} }, { width: 800, height: 600 }), false);
  assert.equal(fit(event, { width: NaN, height: 600 }), false);
});
