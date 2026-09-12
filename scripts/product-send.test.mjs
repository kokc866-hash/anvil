import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createServer } from "vite";

test("product send boundaries preserve drafts and keep guided reviews read-only", async (t) => {
  const savedGlobals = new Map(["window", "document", "localStorage", "fetch", "__productModelCalls", "__productNextResponse"].map(key => [key, globalThis[key]]));
  const values = new Map();
  const timers = new Set();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  globalThis.window = Object.assign(new EventTarget(), {
    localStorage: globalThis.localStorage,
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timers.add(timer); return timer; }, clearTimeout,
    location: { origin: "http://127.0.0.1:9999", protocol: "http:", hostname: "127.0.0.1", pathname: "/" },
  });
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible", getElementById: () => null });
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error("Unexpected network call in product send test"); };
  globalThis.__productModelCalls = [];
  // Only the model response is substituted. Routing, Zustand, history packing,
  // workflow classification, input clearing and file handling run unchanged.
  const server = await createServer({
    configFile: false, root: process.cwd(),
    resolve: { alias: { "@": path.resolve("src") } },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom",
    plugins: [{
      name: "product-test-model-boundary",
      resolveId(id) { if (id === "virtual:product-model-boundary") return "\0product-model-boundary"; },
      load(id) { if (id === "\0product-model-boundary") return `export async function chatWithProvider(options) { globalThis.__productModelCalls.push(options); const next=globalThis.__productNextResponse; delete globalThis.__productNextResponse; return next || {ok:true,reply:"Read-only fixture response; no execution performed."}; }`; },
      transform(code, id) {
        if (id.replaceAll("\\", "/").endsWith("/src/lib/chat-session.ts")) return code.replace('import { chatWithProvider } from "@/lib/agent-client";', 'import { chatWithProvider } from "virtual:product-model-boundary";');
      },
    }],
  });
  t.after(async () => {
    // Let fire-and-forget profile/UI bookkeeping finish before closing its module loader.
    await new Promise(resolve => setTimeout(resolve, 100));
    for (const timer of timers) clearTimeout(timer);
    await server.close();
    for (const [key, value] of savedGlobals) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  });
  const { useIde } = await server.ssrLoadModule("/src/store/ide.ts");
  const { useBrain } = await server.ssrLoadModule("/src/lib/brain/store.ts");
  const { sendChat } = await server.ssrLoadModule("/src/lib/chat-session.ts");
  const { newJob, parseAsk, normalizeJob } = await server.ssrLoadModule("/src/lib/agent-ask.ts");
  const { workflowDraft } = await server.ssrLoadModule("/src/lib/product-workflows.ts");
  const { anvilHandle } = await server.ssrLoadModule("/src/lib/anvil.ts");
  const { isFixPrompt } = await server.ssrLoadModule("/src/lib/agent-parse.ts");
  await server.ssrLoadModule("/src/lib/run-window.ts");
  await server.ssrLoadModule("/src/lib/session.ts");
  const initial = useIde.getState();
  useBrain.setState({ status: "idle", jobs: Object.fromEntries(Object.keys(useBrain.getState().jobs).map(key => [key, false])) });
  const reset = (overrides = {}) => useIde.setState({
    ...initial, workspaceCwd: "", diskName: "", files: { "index.html": "<p>Original project</p>" }, dirs: [],
    activePath: "index.html", openPaths: ["index.html"], dirty: {}, editBases: {}, pendingDiffs: [],
    agentJob: null, agentBusy: false, agentInbox: null, agentQueue: [], agentDraft: "Keep my exact draft", chat: [],
    attached: [], autoSaveDisk: false, llmContextAuto: false, llmProvider: "ollama", llmAuthMode: "key",
    llmModel: "fixture", llmBaseUrl: "http://127.0.0.1:11434/v1", agentMode: "ask", locale: "de", ...overrides,
  });
  const input = (draft, images) => {
    const callbacks = [];
    return {
      callbacks,
      value: { draft, images, title: "Existing title", setTitle: v => callbacks.push(["title", v]), setDraft: v => callbacks.push(["draft", v]), setImages: v => callbacks.push(["images", v]), setMention: v => callbacks.push(["mention", v]) },
    };
  };
  const unchangedData = () => {
    const s = useIde.getState();
    return JSON.stringify({ files: s.files, dirty: s.dirty, pendingDiffs: s.pendingDiffs, queue: s.agentQueue, chat: s.chat, draft: s.agentDraft, busy: s.agentBusy, job: s.agentJob, mode: s.agentMode, checkpoints: s.checkpoints });
  };

  await t.test("unsupported CLI images reject before callbacks, queueing, checkpoints or model calls", async () => {
    for (const [provider, busy] of [["codex", false], ["anthropic", false], ["github", true]]) {
      reset({ llmProvider: provider, llmAuthMode: "abo", agentBusy: busy });
      const request = input("Keep this request", ["data:image/png;base64,AAAA"]);
      const before = unchangedData();
      await sendChat(request.value);
      assert.equal(unchangedData(), before);
      assert.deepEqual(request.callbacks, []);
      assert.match(useIde.getState().notice, /keine Bilder/);
    }
    assert.equal(globalThis.__productModelCalls.length, 0);
    assert.equal(networkCalls, 0);
  });

  await t.test("API images cannot disappear into the text-only busy queue", async () => {
    reset({ agentBusy: true, agentQueue: ["Existing queued request"] });
    const request = input("Please inspect my image", ["data:image/png;base64,AAAA"]);
    const before = unchangedData();
    await sendChat(request.value);
    assert.equal(unchangedData(), before);
    assert.deepEqual(request.callbacks, []);
    assert.match(useIde.getState().notice, /Entwurf bleibt erhalten/);
    assert.equal(globalThis.__productModelCalls.length, 0);
    assert.equal(networkCalls, 0);
  });

  await t.test("image-only API input reaches the model with a useful request and retained image", async () => {
    reset({ llmProvider: "openai", llmModel: "gpt-4.1", llmBaseUrl: "https://api.openai.com/v1" });
    const image = "data:image/png;base64,AAAA";
    const request = input("", [image]);
    const count = globalThis.__productModelCalls.length;
    await sendChat(request.value);
    assert.equal(globalThis.__productModelCalls.length, count + 1);
    const user = useIde.getState().chat.find(message => message.role === "user");
    assert.equal(user.content, "Beschreibe das angehängte Bild.");
    assert.deepEqual(user.images, [image]);
    assert.ok(JSON.stringify(globalThis.__productModelCalls.at(-1).messages).includes(image));
    assert.ok(request.callbacks.some(([kind, value]) => kind === "images" && value.length === 0));
  });

  await t.test("Ask mode never becomes an editing request because of repair words or app shortcuts", async () => {
    for (const draft of ["Behebe diese Probleme: Überschrift falsch", "Fix this bug in index.html", "run"]) {
      reset({ agentMode: "ask" });
      const before = JSON.stringify(useIde.getState().files);
      const count = globalThis.__productModelCalls.length;
      await sendChat(input(draft, []).value);
      assert.equal(globalThis.__productModelCalls.length, count + 1);
      assert.equal(globalThis.__productModelCalls.at(-1).observeOnly, true);
      assert.equal(useIde.getState().agentMode, "ask");
      assert.equal(JSON.stringify(useIde.getState().files), before);
      assert.deepEqual(useIde.getState().pendingDiffs, []);
    }
  });

  await t.test("a restored Ask clarification keeps its original mode even after changing the chat selector", async () => {
    const parsed = parseAsk({ prompt: "Welchen Bereich erklären?", choices: ["Start", "Speichern"] });
    assert.ok(parsed.ask);
    const job = normalizeJob({ ...newJob("Projekt verstehen", "ask"), status: "ask", ask: parsed.ask }, { revive: true });
    reset({ agentMode: "agent", agentJob: job });
    const before = JSON.stringify(useIde.getState().files);
    const count = globalThis.__productModelCalls.length;
    await sendChat(input("Start", []).value, { choiceId: "A" });
    assert.equal(globalThis.__productModelCalls.length, count + 1);
    assert.equal(globalThis.__productModelCalls.at(-1).observeOnly, true);
    assert.equal(JSON.stringify(useIde.getState().files), before);
    assert.equal(useIde.getState().agentJob, null);
  });

  await t.test("Ask can request clarification and continue reading with the original job identity", async () => {
    reset({ agentMode: "ask" });
    const parsed = parseAsk({ prompt: "Welche Datei soll ich erklären?", choices: ["index.html", "Alle"] });
    globalThis.__productNextResponse = { ok: true, parked: true, ask: parsed.ask, reply: parsed.ask.prompt };
    await sendChat(input("Erkläre das Projekt", []).value);
    const parked = useIde.getState().agentJob;
    assert.equal(parked.status, "ask");
    assert.equal(parked.mode, "ask");
    useIde.getState().setAgentMode("agent");
    globalThis.__productNextResponse = { ok: true, parked: true, ask: parsed.ask, reply: parsed.ask.prompt };
    await sendChat(input("index.html", []).value, { choiceId: "A" });
    assert.equal(globalThis.__productModelCalls.at(-1).observeOnly, true);
    assert.equal(useIde.getState().agentJob.id, parked.id);
    assert.equal(useIde.getState().agentJob.mode, "ask");
    assert.equal(useIde.getState().agentJob.rounds, 1);
    assert.equal(useIde.getState().files["index.html"], "<p>Original project</p>");
  });

  await t.test("queued Ask requests preserve mode after switching the next-message selector", async () => {
    reset({ agentBusy: true, agentMode: "ask" });
    const count = globalThis.__productModelCalls.length;
    await sendChat(input("Behebe diese Probleme: nur erklären", []).value);
    const queued = useIde.getState().agentQueue[0];
    assert.equal(queued.mode, "ask");
    assert.equal(globalThis.__productModelCalls.length, count);
    useIde.setState({ agentBusy: false, agentMode: "agent", agentQueue: [] });
    await sendChat(input(queued.text, []).value, { queued: true, mode: queued.mode });
    assert.equal(globalThis.__productModelCalls.at(-1).observeOnly, true);
    assert.equal(useIde.getState().files["index.html"], "<p>Original project</p>");
  });

  await t.test("guided understand/review reaches the actual observe-only send branch despite fix phrases in task", async () => {
    for (const locale of ["de", "en"]) {
      for (const workflow of ["understand", "review"]) {
        const prepared = workflowDraft(workflow, "Behebe diese Probleme: Änderungen nur lesen, nichts ausführen.", locale);
        reset({ agentMode: prepared.mode, locale, ...(workflow === "review" ? { files: { "index.html": "<p>Original project</p>", ".anvil/session.md": "Existing session file" } } : {}) });
        const filesBefore = JSON.stringify(useIde.getState().files);
        assert.equal(isFixPrompt(prepared.text), false, "Only the full message prefix determines a direct fix command");
        assert.equal((await anvilHandle(prepared.text)).hand, "model", "Long guided requests must not be intercepted as short UI commands");
        const count = globalThis.__productModelCalls.length;
        await sendChat(input(prepared.text, []).value);
        assert.equal(globalThis.__productModelCalls.length, count + 1);
        const options = globalThis.__productModelCalls.at(-1);
        assert.equal(options.observeOnly, true);
        assert.equal(options.runLoop, false);
        assert.equal(useIde.getState().agentMode, "ask");
        assert.equal(JSON.stringify(useIde.getState().files), filesBefore);
        assert.deepEqual(useIde.getState().pendingDiffs, []);
        assert.equal(useIde.getState().agentBusy, false);
      }
    }
  });
});
