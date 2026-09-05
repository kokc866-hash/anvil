import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";
import path from "node:path";

// Replace only the GPU boundary. Exercise the real engine cancellation,
// scheduler and store without downloading a model or depending on a GPU.
test("a stalled helper can be unloaded and late tokens cannot enter the next session", async (t) => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  globalThis.window = Object.assign(new EventTarget(), { localStorage: globalThis.localStorage, setTimeout, clearTimeout });
  globalThis.document = new EventTarget();
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    resolve: { alias: { "@": path.resolve("src") } },
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
    plugins: [{
      name: "helper-engine-fixture",
      enforce: "pre",
      transform(code, id) {
        if (id.endsWith("/src/lib/brain/engine.ts")) return code + "\nexport function fixtureEngine(e: Engine, w: Worker | null) { engine = e; worker = w; }\n";
      },
    }],
  });
  t.after(async () => {
    t.mock.timers.reset();
    await server.close();
    delete globalThis.localStorage;
    delete globalThis.window;
    delete globalThis.document;
  });
  const { useBrain } = await server.ssrLoadModule("/src/lib/brain/store.ts");
  const { brainGenerate, unloadBrain, fixtureEngine } = await server.ssrLoadModule("/src/lib/brain/engine.ts");
  const ready = () => useBrain.setState({ on: true, status: "ready", loadedId: "fixture" });
  let completeOld;
  let interrupts = 0;
  let terminated = false;
  fixtureEngine({
    chat: { completions: { create: () => new Promise((resolve) => { completeOld = resolve; }) } },
    interruptGenerate: () => { interrupts += 1; return new Promise(() => {}); },
    unload: () => new Promise(() => {}),
  }, { terminate: () => { terminated = true; } });
  ready();
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const deltas = [];
  const old = brainGenerate({ messages: [{ role: "user", content: "old" }], job: "intent", onDelta: (delta) => deltas.push(delta) });
  const timeout = assert.rejects(old, /Zeitlimit/);
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(800);
  await timeout;
  assert.equal(interrupts, 1);
  assert.equal(useBrain.getState().busy, false);
  await unloadBrain();
  assert.equal(terminated, true, "worker disposal cannot await its stuck interrupt/unload reply");
  fixtureEngine({ chat: { completions: { create: async () => ({ choices: [{ message: { content: "fresh" } }] }) } } }, null);
  ready();
  assert.equal(await brainGenerate({ messages: [{ role: "user", content: "fresh" }], job: "intent" }), "fresh");
  completeOld({ choices: [{ message: { content: "late" } }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(deltas, []);
  assert.equal(useBrain.getState().status, "ready");
  await unloadBrain();
});
