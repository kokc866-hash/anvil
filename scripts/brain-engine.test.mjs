import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";
import path from "node:path";

const flush = () => new Promise((r) => setImmediate(r));
const result = (text) => ({ choices: [{ message: { content: text } }] });
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { resolve, promise }; }

test("helper lifecycle and integrations (no GPU, model download or external request)", async (t) => {
  const values = new Map(), timers = new Set();
  globalThis.localStorage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) };
  globalThis.window = Object.assign(new EventTarget(), { localStorage,
    setTimeout: (fn, ms) => { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); return timer; },
    clearTimeout: (timer) => { timers.delete(timer); clearTimeout(timer); },
  });
  globalThis.document = Object.assign(new EventTarget(), { hidden: false, documentElement: { lang: "de" } });
  const oldGpu = navigator.gpu, oldFetch = globalThis.fetch;
  Object.defineProperty(navigator, "gpu", { value: { requestAdapter: async () => ({ features: new Set(["shader-f16"]), limits: { maxStorageBufferBindingSize: 1024 ** 3 }, info: { vendor: "fixture" } }) }, configurable: true });
  globalThis.fetch = async () => new Response(JSON.stringify({ sha: "fixture-revision" }), { status: 200 });
  let factory;
  const runtime = {
    modelVersion: "fixture-runtime",
    prebuiltAppConfig: { model_list: [{ model_id: "fixture", model: "https://huggingface.co/mlc-ai/fixture", model_lib: "https://huggingface.co/mlc-ai/fixture/model.wasm", overrides: { context_window_size: 4096, max_history_size: 1 } }] },
    MLCEngine: class { constructor(...args) { return factory(...args); } },
    hasModelInCache: async () => false,
  };
  globalThis.helperTestRuntime = runtime;
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } }, server: { middlewareMode: true, hmr: false }, appType: "custom", plugins: [{
    name: "helper-runtime-fixture", enforce: "pre",
    transform(code, id) {
      if (id.endsWith("/src/lib/brain/engine.ts")) return code.replace('return import("@mlc-ai/web-llm");', 'return (globalThis as any).helperTestRuntime;') + '\nexport function fixtureEngine(e: Engine, w: Worker | null = null) { engine = e; worker = w; bindLifetime(); }';
      if (id.endsWith("/src/lib/helper-local.ts")) return code.replaceAll('await import("@mlc-ai/web-llm")', '(globalThis as any).helperTestRuntime');
    },
  }] });
  const { useIde } = await server.ssrLoadModule("/src/store/ide.ts");
  const { useBrain } = await server.ssrLoadModule("/src/lib/brain/store.ts");
  const { useLearn } = await server.ssrLoadModule("/src/lib/learn.ts");
  const { useIntern } = await server.ssrLoadModule("/src/lib/intern.ts");
  useIntern.getState().setPrefs({ on: false, autoHeal: false });
  const e = await server.ssrLoadModule("/src/lib/brain/engine.ts");
  const tasks = await server.ssrLoadModule("/src/lib/brain/tasks.ts");
  const apps = await server.ssrLoadModule("/src/lib/brain/apps.ts");
  const reset = async () => {
    await e.unloadBrain();
    useBrain.setState({ on: true, status: "ready", loadedId: "fixture", modelId: "fixture", customId: "", useWorker: false, autoUpdate: false, autonomy: "quiet", gpuKeepAlive: false, gpuFitBuffer: true, gpuWarmShaders: false, sliding: false, jobs: { ...useBrain.getState().jobs, title: true, distill: true, followup: true, prompts: true, review: true, tabHint: true, ask: true }, context: 8192 });
    useIde.setState({ workspaceEpoch: useIde.getState().workspaceEpoch + 1, files: { "same.ts": "old content of this project, sufficiently long for a hint" }, activePath: "same.ts", chat: [], agentBusy: false });
    useLearn.setState({ on: true, facts: [], prefs: { ...useLearn.getState().prefs, distill: true } });
    e.fixtureEngine({ chat: { completions: { create: async () => result("OK") } } });
  };
  t.after(async () => {
    t.mock.timers.reset();
    await e.unloadBrain();
    const { flushPersistence } = await server.ssrLoadModule("/src/lib/persist-storage.ts");
    await flushPersistence().catch(() => undefined);
    await flush(); await server.close();
    for (const timer of timers) clearTimeout(timer);
    Object.defineProperty(navigator, "gpu", { value: oldGpu, configurable: true });
    globalThis.fetch = oldFetch;
    delete globalThis.helperTestRuntime; delete globalThis.window; delete globalThis.document; delete globalThis.localStorage;
  });

  await t.test("usage callbacks retain model counts and cached replies consume zero tokens", async () => {
    await reset(); let calls = 0; const counts = [];
    e.fixtureEngine({ chat: { completions: { create: async () => { calls++; return { ...result("OK"), usage: { prompt_tokens: 1234, completion_tokens: 56 } }; } } } });
    const opts = { messages: [{ role: "user", content: "usage cache fixture" }], job: "ask", onUsage: (u) => counts.push(u) };
    await e.brainGenerate(opts);
    await e.brainGenerate(opts);
    assert.equal(calls, 1);
    assert.deepEqual(counts, [{ prompt: 1234, completion: 56, estimated: false }, { prompt: 0, completion: 0, estimated: false }]);
  });
  await t.test("streamed helper usage includes the trailing usage event", async () => {
    await reset(); const counts = []; const chunks = [];
    e.fixtureEngine({ chat: { completions: { create: async (payload) => {
      assert.deepEqual(payload.stream_options, { include_usage: true });
      return (async function* () {
        yield { choices: [{ delta: { content: "OK" } }] };
        yield { choices: [], usage: { prompt_tokens: 1234, completion_tokens: 56 } };
      })();
    } } } });
    assert.equal(await e.brainGenerate({ messages: [{ role: "user", content: "usage stream fixture" }], job: "ask", onDelta: (c) => chunks.push(c), onUsage: (u) => counts.push(u) }), "OK");
    assert.equal(chunks.join(""), "OK");
    assert.deepEqual(counts, [{ prompt: 1234, completion: 56, estimated: false }]);
  });
  await t.test("forgetting cancels already running memory distillation", async () => {
    await reset();
    const pending = deferred();
    e.fixtureEngine({ chat: { completions: { create: async () => pending.promise } } });
    const task = tasks.brainDistill("Bitte ausführlich erklären", "Ich erkläre ausführlich.");
    await flush();
    useLearn.getState().clear();
    pending.resolve(result('{"facts":[{"kind":"user","text":"Bevorzugt ausführliche Erklärungen."}]}'));
    await task;
    assert.deepEqual(useLearn.getState().facts, []);
  });
  await t.test("off then on cannot revive a previous learning job", async () => {
    await reset();
    const pending = deferred();
    e.fixtureEngine({ chat: { completions: { create: async () => pending.promise } } });
    const task = tasks.brainDistill("Bitte auf Deutsch", "Ich antworte auf Deutsch.");
    await flush();
    useLearn.getState().setOn(false); useLearn.getState().setOn(true);
    pending.resolve(result('{"facts":[{"kind":"user","text":"Bevorzugt deutsche Antworten."}]}'));
    await task;
    assert.deepEqual(useLearn.getState().facts, []);
  });
  await t.test("an update check never replaces idle/ready/loading status", async () => {
    await reset();
    for (const status of ["idle", "ready", "downloading"]) {
      useBrain.setState({ status });
      await e.checkBrainUpdate();
      assert.equal(useBrain.getState().status, status);
      assert.equal(useBrain.getState().checkingUpdate, false);
    }
  });
  await t.test("removing a model invalidates a pending adoption instead of starting another download", async () => {
    await reset(); await e.unloadBrain();
    const entered = deferred(), reply = deferred(); let downloads = 0;
    window.anvilNative = {
      helperHas: async () => { entered.resolve(); return reply.promise; },
      helperDelete: async () => { reply.resolve(false); return true; },
      helperDownload: async () => { downloads++; return { ok: true }; },
    };
    try {
      const pending = assert.rejects(e.prefetchBrain("fixture"), { name: "AbortError" });
      await entered.promise;
      await e.deleteBrainModel("fixture");
      await pending;
      assert.equal(downloads, 0);
    } finally { delete window.anvilNative; }
  });
  await t.test("removing a model during manifest lookup prevents native install; a later explicit load still works", async () => {
    await reset(); await e.unloadBrain();
    const entered = deferred(), reply = deferred(); let jsonCalls = 0, downloads = 0, progressListeners = 0;
    window.anvilNative = {
      helperHas: async () => false,
      helperDelete: async () => true,
      helperJson: async (url) => {
        jsonCalls++;
        if (jsonCalls === 1) { entered.resolve(); await reply.promise; }
        return JSON.stringify(url.endsWith("mlc-chat-config.json") ? { tokenizer_files: ["tokenizer.json"] } : { records: [{ dataPath: "params.bin" }] });
      },
      onHelperProgress: () => { progressListeners++; return () => { progressListeners--; }; },
      helperDownload: async () => { downloads++; return { ok: true }; },
    };
    try {
      const pending = assert.rejects(e.prefetchBrain("fixture"), { name: "AbortError" });
      await entered.promise;
      await e.deleteBrainModel("fixture");
      reply.resolve(); await pending;
      assert.equal(downloads, 0);
      assert.equal(jsonCalls, 1, "cancel does not continue to the next manifest");
      assert.equal(progressListeners, 0);
      await e.prefetchBrain("fixture");
      assert.equal(downloads, 1);
      assert.equal(progressListeners, 0);
    } finally { delete window.anvilNative; }
  });
  await t.test("duplicate loads share one owner; unload prevents late resurrection and preserves context choice", async () => {
    await reset(); await e.unloadBrain();
    const gate = deferred(); let loads = 0, config;
    factory = () => ({ reload: async (_id, opts) => { loads++; config = opts; await gate.promise; }, unload: async () => {}, chat: { completions: { create: async () => result("OK") } } });
    const a = e.loadBrain(), b = e.loadBrain(true);
    assert.equal(a, b);
    await flush();
    assert.equal(loads, 1);
    await e.unloadBrain(); gate.resolve(); await a;
    assert.equal(useBrain.getState().status, "idle");
    assert.equal(useBrain.getState().loadedId, "");
    assert.equal(config.context_window_size, 8192);
    assert.equal(config.max_history_size, undefined, "retain runtime model's RNN history override");
  });
  await t.test("Qwen3.5 2B loads the selected 32K over the 4K runtime default, including Sliding", async () => {
    const id = "Qwen3.5-2B-q4f16_1-MLC";
    const record = { ...runtime.prebuiltAppConfig.model_list[0], model_id: id };
    runtime.prebuiltAppConfig.model_list.push(record);
    try {
      for (const sliding of [false, true]) {
        await reset(); await e.unloadBrain();
        useBrain.setState({ modelId: id, context: 32768, sliding });
        let config, appConfig;
        factory = (cfg) => {
          appConfig = cfg.appConfig;
          return { reload: async (_id, opts) => { config = opts; }, unload: async () => {}, chat: { completions: { create: async () => result("OK") } } };
        };
        await e.loadBrain(); await flush();
        assert.equal(useBrain.getState().status, "ready");
        assert.equal(config.context_window_size, sliding ? -1 : 32768);
        assert.equal(config.sliding_window_size, sliding ? 32768 : -1);
        assert.equal(config.max_history_size, undefined);
        assert.equal(appConfig.model_list.find((m) => m.model_id === id).overrides.max_history_size, 1);
        assert.match(useBrain.getState().loadedConfig, /^32768 Context/);
      }
    } finally { runtime.prebuiltAppConfig.model_list.pop(); }
  });
  await t.test("a known model limit is preserved and explained without changing the selected context", async () => {
    await reset(); await e.unloadBrain();
    const id = "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC";
    runtime.prebuiltAppConfig.model_list.push({ ...runtime.prebuiltAppConfig.model_list[0], model_id: id });
    try {
      useBrain.setState({ modelId: id, context: 32768 });
      let config;
      factory = () => ({ reload: async (_id, opts) => { config = opts; }, unload: async () => {}, chat: { completions: { create: async () => result("OK") } } });
      await e.loadBrain(); await flush();
      assert.equal(config.context_window_size, 2048);
      assert.equal(useBrain.getState().context, 32768);
      assert.match(useBrain.getState().loadedConfig, /Gewünscht: 32768; Modellgrenze/);
    } finally { runtime.prebuiltAppConfig.model_list.pop(); }
  });
  await t.test("memory fallback is opt-in and never overwrites the selected context or model profile", async () => {
    for (const gpuFitBuffer of [true, false]) {
      await reset(); await e.unloadBrain();
      useBrain.setState({ gpuFitBuffer, autoProfile: true });
      useBrain.getState().setContext(32768);
      const slots = structuredClone(useBrain.getState().helperSlots);
      const contexts = [];
      factory = () => ({ reload: async (_id, opts) => { contexts.push(opts.context_window_size); if (contexts.length === 1) throw new Error("GPU buffer size exceeds device limit"); }, unload: async () => {}, chat: { completions: { create: async () => result("OK") } } });
      await e.loadBrain(); await flush();
      assert.deepEqual(contexts, gpuFitBuffer ? [32768, 2048] : [32768]);
      assert.equal(useBrain.getState().context, 32768);
      assert.deepEqual(useBrain.getState().helperSlots, slots);
      assert.equal(useBrain.getState().status, gpuFitBuffer ? "ready" : "error");
      if (gpuFitBuffer) assert.match(useBrain.getState().loadedConfig, /^2048 Context.*Gewünscht: 32768; wegen GPU-Speicherfehler/);
      else assert.match(useBrain.getState().error, /32768 Context.*GPU buffer/);
    }
  });
  await t.test("unsupported Sliding falls back locally; context-limit errors do not trigger memory reduction", async () => {
    for (const sliding of [true, false]) {
      await reset(); await e.unloadBrain();
      useBrain.setState({ context: 32768, sliding });
      const configs = [];
      factory = () => ({ reload: async (_id, opts) => { configs.push(opts); if (configs.length === 1) throw new Error(sliding ? "sliding_window_size unsupported" : "context_window_size exceeds model limit"); }, unload: async () => {}, chat: { completions: { create: async () => result("OK") } } });
      await e.loadBrain(); await flush();
      assert.equal(useBrain.getState().context, 32768);
      assert.equal(useBrain.getState().sliding, sliding);
      assert.equal(configs.length, sliding ? 2 : 1);
      if (sliding) {
        assert.equal(configs[1].context_window_size, 32768);
        assert.equal(configs[1].sliding_window_size, -1);
        assert.match(useBrain.getState().loadedConfig, /Sliding von Runtime abgelehnt/);
      } else {
        assert.equal(useBrain.getState().status, "error");
        assert.match(useBrain.getState().error, /context_window_size exceeds model limit/);
      }
    }
  });
  await t.test("late facts, followups and tab hints cannot enter another project", async () => {
    for (const start of [() => tasks.brainDistill("Use TypeScript", "configured"), () => apps.brainFollowups("continue", "done"), () => apps.brainTabHint("same.ts", useIde.getState().files["same.ts"])]) {
      await reset(); const gate = deferred();
      e.fixtureEngine({ chat: { completions: { create: () => gate.promise } } });
      const pending = start(); await flush();
      useIde.setState({ workspaceEpoch: useIde.getState().workspaceEpoch + 1, workspaceCwd: "/new-project" });
      useLearn.setState({ on: false });
      gate.resolve(result('{"facts":[{"kind":"project","text":"Use TypeScript for this project"}],"next":["Continue the old project"]}'));
      await pending;
      assert.deepEqual(useLearn.getState().facts, []);
      assert.deepEqual(useBrain.getState().followups, []);
      assert.equal(apps.getTabHint("same.ts"), "");
    }
  });
  await t.test("disabled memory and autonomy block helper work; explicit Ask keeps the question", async () => {
    await reset(); let calls = [];
    e.fixtureEngine({ chat: { completions: { create: async (payload) => { calls.push(payload); return result("A short answer"); } } } });
    useLearn.setState({ on: false }); await tasks.brainDistill("remember", "fact");
    useBrain.setState({ autonomy: "off" });
    await apps.brainFollowups("continue", "done"); await apps.brainSuggestPrompts();
    assert.equal(calls.length, 0);
    await tasks.brainAsk("Why does this fail?", undefined, "old memory ".repeat(500));
    assert.match(calls[0].messages.at(-1).content, /Frage:\nWhy does this fail\?$/);
    assert.ok(calls[0].messages.at(-1).content.length <= 2000);
  });
  await t.test("temperature, stop and JSON requirements use different response cache entries", async () => {
    await reset(); let calls = 0;
    e.fixtureEngine({ chat: { completions: { create: async (p) => { calls++; return result(p.messages[0]?.role === "system" ? '{"ok":true}' : `value${calls}`); } } } });
    const opts = { messages: [{ role: "user", content: "same request" }], job: "ask", maxTokens: 32 };
    assert.equal(await e.brainGenerate({ ...opts, temperature: 0 }), "value1");
    assert.equal(await e.brainGenerate({ ...opts, temperature: 0 }), "value1");
    await e.brainGenerate({ ...opts, temperature: 1 });
    await e.brainGenerate({ ...opts, temperature: 1, stop: ["x"] });
    await e.brainGenerate({ ...opts, temperature: 1, json: true });
    assert.equal(calls, 4);
  });
  await t.test("usage avoids grammar initialization; invalid JSON falls back without unloading or caching it", async () => {
    await reset();
    useBrain.setState({ jobs: { ...useBrain.getState().jobs, usage: true } });
    useLearn.setState({ events: Array.from({ length: 8 }, (_, i) => ({ t: Date.now() - i, k: "open", d: "main.ts" })) });
    let calls = 0;
    e.fixtureEngine({ chat: { completions: { create: async (payload) => {
      calls++;
      assert.equal(payload.response_format, undefined, "do not enter the runtime's hanging grammar path");
      assert.match(payload.messages[0].content, /valid JSON object/);
      return result(calls === 1 ? "not JSON" : '{"facts":[{"kind":"user","text":"Prefers TypeScript for project code."}]}');
    } } } });
    await tasks.brainUsage();
    assert.equal(useLearn.getState().facts.some((f) => f.text === "not JSON"), false);
    assert.equal(useBrain.getState().status, "ready");
    await tasks.brainUsage();
    assert.equal(calls, 2, "invalid output must not be cached");
    assert.ok(useLearn.getState().facts.some((f) => f.text === "Prefers TypeScript for project code."));
    await tasks.brainUsage();
    assert.equal(calls, 2, "validated output is reusable");
    useBrain.setState({ jobs: { ...useBrain.getState().jobs, usage: false } });
    await tasks.brainUsage();
    assert.equal(calls, 2);
  });
  await t.test("empty or reasoning-only output is never successful; reasoning cannot become a title", async () => {
    await reset();
    e.fixtureEngine({ chat: { completions: { create: async () => result("<think>private reasoning</think>") } } });
    await assert.rejects(e.brainGenerate({ messages: [], job: "ping" }), /keine nutzbare/);
    assert.equal(e.firstUsefulLine("<think>wrong title</think>Actual title"), "Actual title");
  });
  await t.test("a responsive cancellation keeps the engine; a stalled one is quarantined and detached", async (tt) => {
    await reset(); tt.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    let gate = deferred(), terminated = false;
    e.fixtureEngine({ chat: { completions: { create: () => gate.promise } }, interruptGenerate: async () => gate.resolve(result("late")) }, { terminate: () => { terminated = true; } });
    let timed = assert.rejects(e.brainGenerate({ messages: [], job: "ask", deadlineMs: 10 }), /Zeitlimit/);
    await flush(); tt.mock.timers.tick(10); await timed; await flush();
    assert.equal(terminated, false); assert.equal(useBrain.getState().status, "ready");
    gate = deferred(); const deltas = [];
    e.fixtureEngine({ chat: { completions: { create: () => gate.promise } }, interruptGenerate: async () => {} }, { terminate: () => { terminated = true; } });
    timed = assert.rejects(e.brainGenerate({ messages: [], job: "ask", deadlineMs: 10, onDelta: (x) => deltas.push(x) }), /Zeitlimit/);
    await flush(); tt.mock.timers.tick(10); await timed;
    assert.equal(terminated, false, "the caller returns before GPU recovery finishes");
    tt.mock.timers.tick(1500); await flush();
    assert.equal(terminated, false, "1.5 seconds is not evidence of a dead GPU");
    tt.mock.timers.tick(28_500); await flush();
    assert.equal(terminated, true); assert.equal(useBrain.getState().status, "error");
    assert.match(useBrain.getState().error, /Zeitlimit.*ask.*30 Sekunden/);
    await e.unloadBrain();
    e.fixtureEngine({ chat: { completions: { create: async () => result("fresh") } } });
    useBrain.setState({ status: "ready", loadedId: "fixture" });
    assert.equal(await e.brainGenerate({ messages: [], job: "ask" }), "fresh");
    gate.resolve(result("old tokens")); await flush();
    assert.deepEqual(deltas, []); assert.equal(useBrain.getState().status, "ready");
    tt.mock.timers.reset();
  });
  await t.test("a new chat request cancels stale helper output immediately while slow GPU work drains safely", async (tt) => {
    await reset(); tt.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const gate = deferred(); let calls = 0, interrupts = 0, terminated = false;
    const deltas = [];
    e.fixtureEngine({ chat: { completions: { create: () => { calls++; return calls === 1 ? gate.promise : Promise.resolve(result("fresh")); } } }, interruptGenerate: async () => { interrupts++; } }, { terminate: () => { terminated = true; } });
    const pending = assert.rejects(e.brainGenerate({ messages: [], job: "ask", onDelta: (value) => deltas.push(value) }), { name: "AbortError" });
    await flush();
    const { beginAgent } = await server.ssrLoadModule("/src/lib/abort.ts");
    beginAgent();
    useIde.getState().setAgentBusy(true);
    await pending;
    assert.equal(interrupts, 1);
    assert.equal(terminated, false);
    await assert.rejects(e.brainGenerate({ messages: [], job: "ask" }), { name: "BrainUnavailable" });
    assert.equal(calls, 1, "no second generation while the previous GPU job still runs");
    tt.mock.timers.tick(5000); await flush();
    assert.equal(terminated, false);
    gate.resolve(result("stale answer")); await flush();
    assert.deepEqual(deltas, []);
    assert.equal(useBrain.getState().status, "ready");
    assert.doesNotMatch(useBrain.getState().progressText, /läuft noch aus/);
    assert.equal(await e.brainGenerate({ messages: [], job: "ask" }), "fresh");
    tt.mock.timers.tick(30_000); await flush();
    assert.equal(terminated, false, "the completed recovery cannot unload a healthy engine later");
    tt.mock.timers.reset();
  });
  await t.test("a stalled direct-GPU unload blocks another allocation until release", async (tt) => {
    await reset(); tt.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const release = deferred(); let allocations = 0;
    e.fixtureEngine({ chat: { completions: { create: async () => result("OK") } }, unload: () => release.promise });
    const unload = e.unloadBrain(); await flush(); tt.mock.timers.tick(1500); await unload;
    factory = () => { allocations++; return { reload: async () => {}, unload: async () => {}, chat: { completions: { create: async () => result("OK") } } }; };
    const blocked = e.loadBrain(); await flush(); tt.mock.timers.tick(1500); await blocked;
    assert.equal(allocations, 0); assert.equal(useBrain.getState().status, "error");
    release.resolve(); await flush(); await e.loadBrain(true); await flush();
    assert.equal(allocations, 1); assert.equal(useBrain.getState().status, "ready");
    tt.mock.timers.reset();
  });
  await t.test("cache misses check the next backend and cache identities omit credentials", async () => {
    await reset();
    const backends = [];
    runtime.hasModelInCache = async (_id, config) => { backends.push(config.cacheBackend); return config.cacheBackend === "indexeddb"; };
    assert.equal(await e.modelCached("fixture-cache"), true);
    assert.deepEqual(backends, ["opfs", "opfs", "indexeddb"]);
    const { modelCacheMatch } = await server.ssrLoadModule("/src/lib/brain/model-cache.ts");
    const record = runtime.prebuiltAppConfig.model_list[0];
    assert.equal(modelCacheMatch(record, "http://127.0.0.1:9999/t/old-token/fixture/resolve/main/params.bin"), true);
    assert.equal(modelCacheMatch(record, "https://anvil-helper.invalid/fixture/revision/params.bin"), true);
    assert.equal(modelCacheMatch(record, "http://127.0.0.1:9999/t/old-token/other/params.bin"), false);
    assert.equal(modelCacheMatch(record, "https://example.com/fixture/params.bin"), false);
  });
  await t.test("the runtime boundary applies GPU preference and authenticated routing only to helper files", async () => {
    await reset();
    const requests = [], powers = [];
    const originalAdapter = navigator.gpu.requestAdapter, originalFetch = globalThis.fetch;
    navigator.gpu.requestAdapter = async (opts) => { powers.push(opts.powerPreference); return {}; };
    globalThis.fetch = async (url) => { requests.push(String(url)); return new Response("ok"); };
    const { installRuntimeEnvironment } = await server.ssrLoadModule("/src/lib/brain/runtime-environment.ts");
    const restore = installRuntimeEnvironment({ power: "low-power", routes: [{ from: "https://anvil-helper.invalid/fixture/revision/", to: "http://127.0.0.1:7847/t/test-token/fixture/" }] });
    try {
      await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      await fetch("https://anvil-helper.invalid/fixture/revision/resolve/main/config.json");
      await fetch("https://example.com/unrelated");
    } finally { restore(); navigator.gpu.requestAdapter = originalAdapter; globalThis.fetch = originalFetch; }
    assert.deepEqual(powers, ["low-power"]);
    assert.deepEqual(requests, ["http://127.0.0.1:7847/t/test-token/fixture/resolve/main/config.json", "https://example.com/unrelated"]);
  });
  await t.test("keepalive is opt-in, skips agent work and hidden windows, and stops when disabled", async (tt) => {
    await reset(); tt.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
    let calls = 0;
    e.fixtureEngine({ chat: { completions: { create: async () => { calls++; return result("OK"); } } } });
    useBrain.setState({ gpuKeepAlive: true });
    useIde.setState({ agentBusy: true });
    tt.mock.timers.tick(70_000); await flush(); assert.equal(calls, 0);
    useIde.setState({ agentBusy: false }); document.hidden = true;
    tt.mock.timers.tick(70_000); await flush(); assert.equal(calls, 0);
    document.hidden = false;
    tt.mock.timers.tick(70_000); await flush(); assert.equal(calls, 1);
    useBrain.setState({ gpuKeepAlive: false });
    tt.mock.timers.tick(70_000); await flush(); assert.equal(calls, 1);
    tt.mock.timers.reset();
  });
  await t.test("explicit small and 4B selections and pins survive hydration merge", async () => {
    const { migrateBrainModel } = await server.ssrLoadModule("/src/lib/brain/models.ts");
    const { useModelLib } = await server.ssrLoadModule("/src/lib/model-lib.ts");
    for (const id of ["SmolLM2-360M-Instruct-q4f16_1-MLC", "Qwen3.5-4B-q4f16_1-MLC"]) {
      assert.equal(migrateBrainModel(id), id);
      assert.equal(useBrain.persist.getOptions().merge({ modelId: id, customId: id }, useBrain.getState()).customId, id);
      assert.deepEqual(useModelLib.persist.getOptions().merge({ pinHelper: [id] }, useModelLib.getState()).pinHelper, [id]);
    }
  });
});
