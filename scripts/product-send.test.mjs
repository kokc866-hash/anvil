import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createServer } from "vite";

test("product send boundaries preserve drafts and keep guided reviews read-only", async (t) => {
  const savedGlobals = new Map(["window", "document", "localStorage", "fetch", "__productModelCalls", "__productNextResponse", "__productNextRun", "__productNextPlan"].map(key => [key, globalThis[key]]));
  const values = new Map();
  const timers = new Set();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  globalThis.window = Object.assign(new EventTarget(), {
    localStorage: globalThis.localStorage,
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timers.add(timer); return timer; }, clearTimeout,
    setInterval: (fn, ms) => { const timer = setInterval(fn, ms); timers.add(timer); return timer; }, clearInterval,
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
      resolveId(id) { if (id === "virtual:product-model-boundary") return "\0product-model-boundary"; if (id === "virtual:product-run-boundary") return "\0product-run-boundary"; if (id === "virtual:product-plan-boundary") return "\0product-plan-boundary"; },
      load(id) {
        if (id === "\0product-model-boundary") return `export async function chatWithProvider(options) { globalThis.__productModelCalls.push(options); const next=globalThis.__productNextResponse; delete globalThis.__productNextResponse; return typeof next === "function" ? next(options) : next || {ok:true,reply:"Read-only fixture response; no execution performed."}; }`;
        if (id === "\0product-run-boundary") return `export async function runFile(path, files) { if (!globalThis.__productNextRun) throw Error("Unexpected automatic run"); return globalThis.__productNextRun(path, files); }`;
        if (id === "\0product-plan-boundary") return `export async function brainPlanText() { const next=globalThis.__productNextPlan; delete globalThis.__productNextPlan; return next || []; }`;
      },
      transform(code, id) {
        if (id.replaceAll("\\", "/").endsWith("/src/lib/chat-session.ts")) return 'import { brainPlanText } from "virtual:product-plan-boundary";\n' + code.replace(/  brainPlanText,\r?\n/, '').replace('import { chatWithProvider } from "@/lib/agent-client";', 'import { chatWithProvider } from "virtual:product-model-boundary";').replace('import { runFile } from "@/lib/run-client";', 'import { runFile } from "virtual:product-run-boundary";');
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

  await t.test("text-only helper images reject before callbacks, queueing, checkpoints or model calls", async () => {
    for (const [provider, busy] of [["brain", false], ["brain", true]]) {
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

  await t.test("CLI image-only requests preserve images through chat routing for every supported subscription", async () => {
    for (const provider of ["codex", "anthropic", "github"]) {
      reset({ llmProvider: provider, llmAuthMode: "abo", llmModel: "gpt-5.6-terra" });
      const image = "data:image/png;base64,AAAA";
      const count = globalThis.__productModelCalls.length;
      await sendChat(input("", [image]).value);
      assert.equal(globalThis.__productModelCalls.length, count + 1, provider);
      assert.deepEqual(useIde.getState().chat.find(m => m.role === "user").images, [image]);
      assert.ok(JSON.stringify(globalThis.__productModelCalls.at(-1)).includes(image), `${provider} carries image to model boundary`);
    }
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

  await t.test("image questions reach the model even with app help enabled", async () => {
    const jobs=useBrain.getState().jobs;
    useBrain.setState({jobs:{...jobs,help:true}});
    try {
      for(const mode of ['agent','ask'])for(const draft of ['was siehst du auf dem bild','wo sind die Einstellungen','run']) {
        reset({agentMode:mode});
        const image='data:image/png;base64,AAAA',count=globalThis.__productModelCalls.length;
        await sendChat(input(draft,[image]).value);
        assert.equal(globalThis.__productModelCalls.length,count+1,`${mode}: ${draft}`);
        assert.ok(JSON.stringify(globalThis.__productModelCalls.at(-1).messages).includes(image));
        assert.doesNotMatch(useIde.getState().chat.at(-1).content,/Activity links/);
      }
      assert.equal((await anvilHandle('was siehst du auf dem bild')).hand,'model');
      assert.equal((await anvilHandle('wie funktioniert Photosynthese')).hand,'model');
      assert.equal((await anvilHandle('wo sind die Einstellungen')).hand,'app');
    } finally {useBrain.setState({jobs});}
  });

  await t.test("foreground send reserves the agent before the queue can consume another entry", async () => {
    reset({ backgroundAgent: false });
    const pending = sendChat(input("Describe the fixture project", []).value);
    try {
      assert.equal(useIde.getState().agentBusy, true, "claim the foreground turn before yielding to background routing");
      useIde.getState().pushAgent("Second queued request", false, "ask");
      assert.equal(useIde.getState().agentInbox, null);
      assert.deepEqual(useIde.getState().agentQueue, [{ text: "Second queued request", mode: "ask" }]);
    } finally { await pending; }
  });

  await t.test("late health startup does not cancel a newly started queue request", async () => {
    const { startHealth } = await server.ssrLoadModule("/src/lib/health.ts");
    const { agentGen } = await server.ssrLoadModule("/src/lib/abort.ts");
    reset({ backgroundAgent: false });
    const pending = sendChat(input("Describe the fixture project", []).value);
    const generation = agentGen();
    try {
      startHealth();
      assert.equal(agentGen(), generation, "startup recovery must not replace a live request");
      assert.equal(useIde.getState().agentBusy, true);
    } finally { await pending; }
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
  await t.test("a no-write agent round preserves SVG source and binary image data", async () => {
    const assets = { "badge.svg": '<svg width="128" height="128"><rect rx="16" fill="#ff3333"/></svg>', "icon.png": "data:image/png;base64,AQIDBA==" };
    reset({ agentMode: "agent", files: assets, autoRunAgent: false, testLoop: false, autoAcceptDiffs: true });
    globalThis.__productNextResponse = options => ({ ok: true, reply: "Nur geprüft, keine Änderung.", files: options.files, tools: [] });
    await sendChat(input("Prüfe die vorhandenen Dateien ohne Änderungen.", []).value);
    const options = globalThis.__productModelCalls.at(-1);
    assert.deepEqual(Object.fromEntries(options.files.map(f => [f.path, f.content])), assets);
    for (const [name, source] of Object.entries(assets)) assert.equal(useIde.getState().files[name], source, name);
    assert.deepEqual(useIde.getState().pendingDiffs, []);
  });
  await t.test("an already applied snapshot cannot overwrite a newer edit at completion", async () => {
    reset({ agentMode: "agent", files: { "index.html": "before" }, autoRunAgent: false, testLoop: false, autoAcceptDiffs: true });
    globalThis.__productNextResponse = async options => {
      await options.onWorkspace({ op: "write", path: "index.html", content: "agent edit" });
      useIde.getState().writeFile("index.html", "newer user edit");
      return { ok: true, reply: "Fertig", applied: true, files: [{ path: "index.html", content: "agent edit" }] };
    };
    await sendChat(input("Ändere den vorhandenen Text.", []).value);
    assert.equal(useIde.getState().files["index.html"], "newer user edit");
  });
  await t.test("the real agent loop updates the visible locked checklist and replaces premature streamed completion", async () => {
    const { runAgentLoop } = await server.ssrLoadModule('/src/lib/agent-core.ts');
    reset({ agentMode: "agent", autoRunAgent: false, runLoop: false, testLoop: false, afterWrite: "none", planWho: "anvil" });
    const labels = ['Bestandsaufnahme des Dokuments', 'Titelkorrektur'];
    globalThis.__productNextResponse = async options => {
      useIde.getState().setChatPlan(labels.map(text => ({ text, status: 'todo' })));
      assert.equal(options.canReplacePlan(), false);
      let n = 0;
      const tool = (name, args) => ({ content: '', tool_calls: [{ id: `p${n}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
      return runAgentLoop({ messages: options.messages, files: options.files, runLoop: false, afterWrite: 'none', maxRounds: 12 }, async () => {
        if (++n === 1) return tool('read_file', { path: 'index.html' });
        if (n === 2) return tool('edit_file', { path: 'index.html', old_string: 'Original project', new_string: 'Updated project' });
        if (n === 3) { options.onDelta('Vorläufig schon fertig.'); return { content: 'Titel angepasst.' }; }
        if (n === 4) return tool('set_plan', { updates: labels.map((_, i) => ({ step: i + 1, kind: i ? 'edit' : 'read', status: 'ok', evidence: [`e${i + 1}`], reason: 'Document inspected and title changed.' })) });
        return { content: 'Titel geändert; Dokument vorher gelesen.' };
      }, options);
    };
    await sendChat(input('Ändere den Titel im Dokument. Kein Run nötig.', []).value);
    const message = useIde.getState().chat.at(-1);
    assert.deepEqual(message.plan.map(s => s.text), labels);
    assert.deepEqual(message.plan.map(s => s.status), ['ok', 'ok']);
    assert.doesNotMatch(message.content, /Vorläufig/);
    assert.match(message.content, /Titel geändert/);
    assert.equal(useIde.getState().files['index.html'], '<p>Updated project</p>');
  });

  await t.test("a delayed helper cannot replace progress during or after the request", async () => {
    for (const timing of ['during', 'after']) {
      reset({agentMode:'agent',planWho:'helper',autoRunAgent:false,testLoop:false});
      let resolvePlan;
      globalThis.__productNextPlan = new Promise(resolve => { resolvePlan = resolve; });
      globalThis.__productNextResponse = async () => {
        useIde.getState().setChatPlan([{text:'Vorhandener Fortschritt',status:'ok'}]);
        if (timing === 'during') { resolvePlan(['Neue Liste','Überschreibt Fortschritt','Nicht zulässig']); await new Promise(resolve => setTimeout(resolve,0)); }
        return {ok:true,reply:'Abgeschlossen.'};
      };
      await sendChat(input('Erkläre das Projekt.',[]).value);
      if (timing === 'after') { resolvePlan(['Späte Liste','Arbeit vorbei','Nicht zulässig']); await new Promise(resolve => setTimeout(resolve,0)); }
      assert.deepEqual(useIde.getState().chat.at(-1).plan,[{text:'Vorhandener Fortschritt',status:'ok'}]);
    }
  });

  await t.test("round limit stays visibly incomplete throughout a successful automatic Run", async () => {
    reset({ agentMode: "agent", files: { "main.js": "console.log(1)" }, autoRunAgent: true, runInWindow: false, testLoop: false, planWho: "agent" });
    const reply = "Unterbrochen: Rundenlimit 8/8 erreicht. Auftrag noch offen.";
    globalThis.__productNextResponse = options => {
      options.onHarness("Arbeit · Runden 8/8 · Run 3/3 · Tools 46/64");
      return { ok: false, stopReason: "round-limit", error: "Rundenlimit", modelReply: reply, reply, runPaths: ["main.js"], tools: ["edit_file"] };
    };
    globalThis.__productNextRun = async () => {
      const message = useIde.getState().chat.at(-1);
      assert.match(message.harness, /^Unterbrochen · Rundenlimit/);
      assert.match(message.harness, /Runden 8\/8/);
      return { ok: true, stdout: "1", stderr: "", duration: 0.01, label: "main.js" };
    };
    await sendChat(input("Schreibe das Programm und prüfe es.", []).value);
    const message = useIde.getState().chat.at(-1);
    assert.match(message.harness, /^Unterbrochen · Rundenlimit/);
    assert.match(message.harness, /Runden 8\/8/);
    assert.equal(message.content, reply);
    assert.equal(message.lastRun.ok, true, "successful Run is still recorded separately");
  });

  await t.test("automatic execution replaces stale completion text and updates the visible plan", async () => {
    reset({ agentMode: "agent", files: { "main.js": "console.log(1)" }, autoRunAgent: true, runInWindow: false, testLoop: false, planWho: "agent" });
    globalThis.__productNextResponse = options => {
      options.onTool({ name: "set_plan", args: {}, result: { steps: ["Ändern", "Run"] } });
      options.onToolStart({ name: "edit_file", args: { path: "main.js" } });
      options.onTool({ name: "edit_file", args: { path: "main.js" }, result: { ok: true } });
      return { ok: true, modelReply: "Berechnung korrigiert.", reply: "Noch nicht bestätigt: alter Stand\n\nModellantwort:\nBerechnung korrigiert.", verification: { state: "stale", detail: "alter Stand" }, runPaths: ["main.js"], tools: ["edit_file", "run_file"] };
    };
    globalThis.__productNextRun = async path => { assert.equal(path, "main.js"); return { ok: true, stdout: "1", stderr: "", duration: 0.01, label: path }; };
    await sendChat(input("Korrigiere die Berechnung und führe sie aus.", []).value);
    const message = useIde.getState().chat.at(-1);
    assert.equal(message.content, "Berechnung korrigiert.\n\nAutomatischer Run nach der letzten Änderung erfolgreich.");
    assert.ok(message.plan.every(step => step.status === "ok"));
    assert.doesNotMatch(message.harness, /offen/);
    globalThis.__productNextResponse = { ok: true, modelReply: "Alte Erfolgsaussage.", reply: "Alte Erfolgsaussage.", runPaths: ["main.js"] };
    globalThis.__productNextRun = async () => { throw new Error("Run-Verbindung getrennt"); };
    await sendChat(input("Führe den aktuellen Stand erneut aus.", []).value);
    assert.match(useIde.getState().chat.at(-1).content, /Run-Verbindung getrennt/);
    assert.doesNotMatch(useIde.getState().chat.at(-1).content, /Alte Erfolgsaussage/);
  });
});
