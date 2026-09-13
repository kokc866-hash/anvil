import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createServer } from "vite";

test("a new Run cancels pending closure from the previous agent tool", async (t) => {
  const globals = new Map(["window", "document", "localStorage"].map(key => [key, globalThis[key]]));
  const values = new Map(), timers = new Map();
  let sequence = 0, alive = false, closes = 0;
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const native = {
    childAlive: async () => alive,
    openChild: async () => { alive = true; return 1; },
    focusChild: async () => alive,
    closeChild: async () => { closes++; alive = false; return true; },
  };
  globalThis.localStorage = storage;
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  globalThis.window = Object.assign(new EventTarget(), {
    localStorage: storage, anvilNative: native,
    location: { pathname: "/" }, screen: { availWidth: 1600, availHeight: 900 },
    setTimeout: (fn, ms) => { const id = ++sequence; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval: () => ++sequence, clearInterval: () => {},
  });
  const firePendingClose = async () => {
    for (const [id, timer] of [...timers]) if (timer.ms === 400) { timers.delete(id); timer.fn(); }
    // closeRunWindow is deliberately queued, so observe after the queue settles.
    await new Promise(resolve => setImmediate(resolve));
  };
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } }, server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  t.after(async () => {
    await server.close();
    for (const [key, value] of globals) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  });
  const { useIde } = await server.ssrLoadModule("/src/store/ide.ts");
  const ui = await server.ssrLoadModule("/src/lib/run-window.ts");
  useIde.setState({ agentBusy: true, runInWindow: true, runPopout: false, companionKeep: true });

  await t.test("automatic Run keeps an existing window alive through the old close deadline", async () => {
    await ui.openRunWindow({ agent: true });
    ui.agentToolUi("write_file", "app.mjs");
    assert.ok([...timers.values()].some(timer => timer.ms === 400), "the prior edit schedules a close");
    await ui.ensureCanvasOutput();
    await firePendingClose();
    assert.equal(alive, true, "Run must not lose its window during the canvas handshake");
    assert.equal(closes, 0);
    assert.equal(useIde.getState().runPopout, true);
  });

  await t.test("reopening directly also cancels a previous delayed close", async () => {
    await ui.openRunWindow({ agent: true });
    ui.agentToolUi("set_plan");
    const before = closes;
    await ui.openRunWindow({ agent: true });
    await firePendingClose();
    assert.equal(alive, true);
    assert.equal(closes, before);
  });

  await t.test("docked automatic output survives the previous tool's close deadline", async () => {
    ui.releaseAgentUi();
    await new Promise(resolve => setImmediate(resolve));
    useIde.setState({ runInWindow: false, runPopout: false, previewOpen: true });
    ui.agentOpenedPreview();
    ui.agentToolUi("write_file", "app.mjs");
    await ui.ensureCanvasOutput();
    await firePendingClose();
    assert.equal(useIde.getState().previewOpen, true);
  });

  await t.test("an unused agent output still closes and explicit release still works", async () => {
    useIde.setState({ runInWindow: true });
    await ui.openRunWindow({ agent: true });
    ui.agentToolUi("write_file", "app.mjs");
    await firePendingClose();
    assert.equal(alive, false);
    await ui.ensureCanvasOutput();
    assert.equal(alive, true);
    ui.releaseAgentUi();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(alive, false);
  });
});
