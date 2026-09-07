/** Real ChatPane send regression, using a stalled GPU fixture and no paid APIs.
 * Run via npm run test:chat-send; --production verifies the built app as well.
 * ANVIL_CHROMIUM_PATH can select an already installed Chromium binary. */
import assert from "node:assert/strict";
import { createServer as httpServer } from "node:http";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createServer, preview } from "vite";
import { chromium } from "playwright";
import { createLlmPipeServer } from "../electron/llm-pipe.mjs";

const production = process.argv.includes("--production");
const requests = [];
const reply = (provider) => `${provider}-Antwort angekommen. Ich bin der Testserver und bestätige, dass die Chat-Anfrage mit dem gewählten Modell vollständig angekommen ist.`;
const sse = (data) => `data: ${JSON.stringify(data)}\n\n`;
const upstream = httpServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (req.method === "POST") {
    const payload = JSON.parse(body);
    requests.push({ provider: "LAN", url: req.url, body: payload });
    if (req.url !== "/api/chat") { res.writeHead(404); res.end("expected native Ollama chat"); return; }
    if (JSON.stringify(payload.messages).includes("fixture-http-error")) {
      res.writeHead(404, { "content-type": "application/json" }); res.end('{"error":"model not found"}'); return;
    }
    const toolRound = JSON.stringify(payload.messages).includes("fixture-tool-round") && !payload.messages.some((message) => message.role === "tool");
    res.writeHead(200, { "content-type": payload.stream ? "application/x-ndjson" : "application/json" });
    const message = toolRound ? { role: "assistant", thinking: "Ich lese die Datei.", tool_calls: [{ function: { name: "read_file", arguments: { path: "README.md" } } }] } : { role: "assistant", content: reply("LAN") };
    res.end(JSON.stringify({ message, done: true, done_reason: "stop", prompt_eval_count: 123, eval_count: 17 }) + (payload.stream ? "\n" : ""));
  } else {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "fixture-local" }] }));
  }
});
const pipe = createLlmPipeServer("send-fixture");
let server;
let browser;
try {
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  pipe.listen(0, "127.0.0.1");
  await once(pipe, "listening");
  const cfg = {
    pipe: { port: pipe.address().port, token: "send-fixture" },
    base: `http://127.0.0.1:${upstream.address().port}/v1`,
  };
  server = production
    ? await preview({ preview: { host: "127.0.0.1", port: 8189, strictPort: true } })
    : await createServer({
        cacheDir: "node_modules/.vite-chat-send",
        server: { host: "127.0.0.1", port: 8189, strictPort: true },
        plugins: [{
          name: "stalled-helper-fixture",
          enforce: "pre",
          transform(code, id) {
            if (!id.endsWith("/src/lib/brain/engine.ts")) return;
            const declaration = "let engine: Engine | null = null;";
            assert.ok(code.includes(declaration), "helper fixture must replace the engine, not skip the queue");
            return code.replace(declaration, "let engine: Engine | null = {chat:{completions:{create:async()=>new Promise(()=>{})}},interruptGenerate:async()=>{}};");
          },
        }],
      });
  if (!production) await server.listen();
  browser = await chromium.launch({
    executablePath: process.env.ANVIL_CHROMIUM_PATH || undefined,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-zygote", "--disable-gpu"],
  });

  async function openChat(provider, mode = "agent", pauseHelper = false) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    if (pauseHelper) await page.clock.install();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Keep OpenAI's real provider/URL/Responses serializer, intercept only the
    // external boundary. LAN goes through the actual native pipe and HTTP POST.
    await page.route("**/pipe", async (route) => {
      const req = route.request();
      const target = req.headers()["x-anvil-target"] || "";
      if (target.startsWith(cfg.base.replace(/\/v1$/, ""))) return route.continue();
      assert.ok(target.startsWith("https://api.openai.com/v1/"), `unexpected model destination: ${target}`);
      const headers = {
        "access-control-allow-origin": "http://127.0.0.1:8189",
        "access-control-expose-headers": "x-anvil-lan",
        "x-anvil-lan": "1",
        "content-type": "text/event-stream",
      };
      if (req.method() !== "POST") return route.fulfill({ headers, body: JSON.stringify({ data: [{ id: "gpt-5.6-terra" }] }) });
      requests.push({ provider: "API", url: target, body: req.postDataJSON() });
      assert.equal(target, "https://api.openai.com/v1/responses");
      return route.fulfill({ headers, body:
        sse({ type: "response.output_text.delta", delta: reply("API") }) +
        sse({ type: "response.completed", response: { output_text: reply("API"), output: [] } }),
      });
    });
    await page.addInitScript(({ cfg, provider, mode }) => {
      localStorage.setItem("anvil-ide", JSON.stringify({ state: {
        setupDone: true, autoUpdate: false, llmProvider: provider,
        llmBaseUrl: provider === "ollama" ? cfg.base : "https://api.openai.com/v1",
        llmModel: provider === "ollama" ? "fixture-local" : "gpt-5.6-terra",
        llmAuthMode: "key", llmApiKey: provider === "ollama" ? "" : "fixture-key",
        llmContext: 8192, llmContextAuto: false, llmThinking: "low",
        agentMode: mode, activeSurfaceId: "anvil", mcpServers: [],
        files: { "index.html": "<h1>Fixture</h1>", "README.md": "Fixture documentation" },
        activePath: null, openPaths: [], attached: [], autoRunAgent: false,
      }, version: 0 }));
      // Production verifies the unmodified bundle. The dev regression below
      // enables a fake loaded GPU engine but uses the real scheduler/apps/send.
      localStorage.setItem("anvil-brain", JSON.stringify({ state: { on: false, autoLoad: false }, version: 0 }));
      // A failed /v1 attempt from 1.3.14 must not disable native chat capabilities.
      localStorage.setItem("anvil-model-caps", JSON.stringify({ "ollama::fixture-local": { tools: "off", noThinkWithTools: true, noStreamTools: true, at: Date.now() } }));
      window.anvilNative = {
        llmPipe: async () => cfg.pipe,
        companionEnsure: async () => ({ ok: true }),
        companionRelease: async () => ({ ok: true }),
      };
    }, { cfg, provider, mode });
    const response = await page.goto("http://127.0.0.1:8189", { waitUntil: "domcontentloaded", timeout: 45_000 });
    assert.equal(response.status(), 200);
    await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
    await page.locator("#anvil-chat").waitFor();
    if (!production) {
      if (pauseHelper) {
        // Keep preparation pending while Playwright locates Stop; its click must
        // happen before the helper deadline, independently of CI rendering speed.
        await page.clock.pauseAt(Date.now() + 1000);
      }
      await page.evaluate(async () => {
        const { useBrain } = await import("/src/lib/brain/store.ts");
        const { brainGenerate } = await import("/src/lib/brain/engine.ts");
        if (!useBrain.persist.hasHydrated()) await useBrain.persist.rehydrate();
        useBrain.setState({ on: true, status: "ready", loadedId: "fixture-helper", autonomy: "off", autoLoad: false, autoUpdate: false,
          jobs: { ...useBrain.getState().jobs, attach: true, intent: true, title: true, planText: false },
        });
        window.fixtureBrain = useBrain;
        void brainGenerate({ messages: [{ role: "user", content: "stalled" }], job: "title" }).catch(() => {});
      });
      assert.equal(await page.evaluate(() => window.fixtureBrain.getState().busy), true);
    }
    await page.evaluate((provider) => {
      window.__anvilIde.getState().setLlmApiKey(provider === "ollama" ? "" : "fixture-key");
    }, provider);
    return { page, errors };
  }

  async function send(page, prompt, frozenClock = false) {
    await page.locator("#anvil-chat").fill(prompt);
    // Let React commit the controlled input and busy button while helper deadlines
    // remain frozen. Enter must not read the preceding empty draft on a slow runner.
    if (frozenClock) await page.clock.runFor(32);
    await page.locator("#anvil-chat").press("Enter");
    if (frozenClock) {
      // Dynamic imports use real I/O; wait for preparation without advancing its clock.
      const deadline = Date.now() + 5000;
      while (!(await page.evaluate(() => window.__anvilIde.getState().agentBusy)) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 20));
      await page.clock.runFor(32);
    }
  }
  async function answered(page, provider) {
    try {
      await page.getByText(reply(provider), { exact: false }).waitFor({ timeout: 10_000 });
    } catch (error) {
      console.error("Send state", await page.evaluate(() => ({ busy: window.__anvilIde.getState().agentBusy, chat: window.__anvilIde.getState().chat.map((m) => ({ role: m.role, content: m.content })), helper: window.fixtureBrain?.getState().busy })), requests.map((r) => ({ provider: r.provider, url: r.url, model: r.body.model })));
      throw error;
    }
    await page.waitForFunction(() => !window.__anvilIde.getState().agentBusy);
    if (!production) await page.waitForFunction(() => !window.fixtureBrain.getState().busy);
  }

  if (!production) {
    const { page, errors } = await openChat("ollama");
    const before = requests.length;
    // Pause the composer while exercising store transitions in one browser task.
    await page.evaluate(() => {
      const st = window.__anvilIde;
      st.setState({ panels: { ...st.getState().panels, agent: false } });
    });
    await page.locator("#anvil-chat").waitFor({ state: "detached" });
    const state = await page.evaluate(async () => {
      const { flushLiveChat } = await import("/src/store/ide.ts");
      const { beginAgent, stopAgent, agentAborted } = await import("/src/lib/abort.ts");
      await import("/src/lib/companion-life.ts");
      await import("/src/lib/run-window.ts");
      const st = window.__anvilIde;
      st.setState({ chat: [], agentInbox: "old inbox", agentQueue: ["old queued job"], agentDraft: "old draft", pendingAsk: { path: "old.ts", text: "old selection" } });
      st.getState().startAssistant();
      st.getState().appendAssistant("OLD BUFFER");
      st.getState().clearChat();
      st.getState().startAssistant();
      flushLiveChat();
      const cleared = { text: st.getState().chat.at(-1).content, inbox: st.getState().agentInbox, queue: st.getState().agentQueue, draft: st.getState().agentDraft, ask: st.getState().pendingAsk };

      st.setState({ chat: [] });
      st.getState().startAssistant();
      const original = st.getState().chat.at(-1).id;
      st.getState().appendAssistant("first answer");
      st.getState().appendThinking("first thought");
      st.getState().addChat({ role: "user", content: "next question" });
      st.getState().startAssistant();
      st.getState().appendAssistant("second answer");
      flushLiveChat();
      const originalMessage = st.getState().chat.find((m) => m.id === original);
      const separated = { first: originalMessage.content, thought: originalMessage.thinking, second: st.getState().chat.at(-1).content };
      st.getState().appendAssistant("wrong workspace");
      st.setState({ workspaceEpoch: st.getState().workspaceEpoch + 1 });
      flushLiveChat();
      const afterWorkspace = st.getState().chat.at(-1).content;

      beginAgent(); st.getState().setAgentBusy(true);
      stopAgent("previous stop");
      beginAgent(); st.getState().setAgentBusy(true);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const restartedBusy = st.getState().agentBusy;
      const active = st.getState().chat.at(-1).id;
      st.getState().appendAssistant("pending before deletion");
      st.getState().removeChat(active);
      flushLiveChat();
      const removed = { busy: st.getState().agentBusy, aborted: agentAborted(), first: st.getState().chat.find((m) => m.id === original).content };
      return { cleared, separated, afterWorkspace, restartedBusy, removed };
    });
    assert.deepEqual(state.cleared, { text: "", inbox: null, queue: [], draft: "", ask: null });
    assert.deepEqual(state.separated, { first: "first answer", thought: "first thought", second: "second answer" });
    assert.equal(state.afterWorkspace, "second answer");
    assert.equal(state.restartedBusy, true, "a previous Stop must not stop the new request");
    assert.deepEqual(state.removed, { busy: false, aborted: true, first: "first answer" });

    const label = "Werkzeug läuft · read_file · " + "long-path/".repeat(16);
    await page.evaluate(async (label) => {
      const st = window.__anvilIde;
      const { beginAgent } = await import("/src/lib/abort.ts");
      const { useRequestState } = await import("/src/lib/request-state.ts");
      beginAgent();
      useRequestState.setState({ phase: "tool", detail: label.replace("Werkzeug läuft · ", "") });
      st.setState({ locale: "de", agentBusy: true, agentStartedAt: Date.now(), panels: { ...st.getState().panels, agent: true, trail: false }, chat: [{ id: "status-fixture", role: "assistant", content: "Current answer", at: Date.now() }] });
    }, label);
    const status = page.getByRole("status", { name: label, exact: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 390) await page.getByRole("navigation", { name: "Arbeitsbereich" }).getByRole("button", { name: "Agent", exact: true }).click();
      await status.focus();
      await page.getByRole("tooltip").filter({ hasText: label }).waitFor();
      const layout = await status.evaluate((el) => {
        const time = el.previousElementSibling.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        const tip = document.getElementById(el.getAttribute("aria-describedby"));
        const t = tip.getBoundingClientRect();
        return { inMessage: Boolean(el.closest("[data-chat-msg]")), afterTime: r.left >= time.right && Math.abs(r.top - time.top) < 3, static: getComputedStyle(el).position === "static", fits: t.left >= 7 && t.right <= innerWidth - 7 && tip.scrollWidth <= tip.clientWidth + 1 };
      });
      assert.deepEqual(layout, { inMessage: true, afterTime: true, static: true, fits: true });
      await page.keyboard.press("Escape");
      await page.getByRole("tooltip").waitFor({ state: "detached" });
      await status.evaluate((el) => el.blur());
    }
    assert.equal(requests.length, before, "chat state checks must not invoke a model");
    assert.deepEqual(errors, []);
    console.log("CHAT_RESET_STREAM_STOP_STATUS_OK");
    await page.close();
  }

  {
    const { page, errors } = await openChat("ollama");
    const before = requests.length;
    await page.evaluate(() => {
      const st = window.__anvilIde.getState();
      st.pushAgent("hi wer bist du fixture-queue-first");
      st.pushAgent("hi wer bist du fixture-queue-second");
    });
    await page.waitForFunction(() => {
      const st = window.__anvilIde.getState();
      return !st.agentBusy && !st.agentInbox && !st.agentQueue.length && st.chat.filter((m) => m.role === "assistant" && m.content.includes("LAN-Antwort angekommen")).length === 2;
    }, undefined, { timeout: 20_000 });
    assert.deepEqual(await page.evaluate(() => window.__anvilIde.getState().chat.filter((m) => m.role === "user").map((m) => m.content)), ["hi wer bist du fixture-queue-first", "hi wer bist du fixture-queue-second"]);
    assert.equal(requests.length, before + 2, "each queued instruction must reach the model exactly once");
    assert.deepEqual(errors, []);
    console.log(`${production ? "PRODUCTION" : "DEV"}_CHAT_FIFO_OK`);
    await page.close();
  }

  for (const [provider, label, mode] of [["ollama", "LAN", "agent"], ["openai", "API", "agent"], ["openai", "API", "ask"]]) {
    const { page, errors } = await openChat(provider, mode);
    const before = requests.length;
    await send(page, "hi wer bist du");
    await answered(page, label);
    const sent = requests.slice(before);
    assert.equal(sent.length, 1, "a completed answer must not be repeated because of attached context");
    for (const request of sent) {
      assert.equal(request.provider, label);
      assert.equal(request.body.model, provider === "ollama" ? "fixture-local" : "gpt-5.6-terra");
      if (provider === "ollama") {
        assert.equal(request.url, "/api/chat");
        assert.equal(request.body.options.num_ctx, 8192);
        assert.equal(request.body.think, "low");
        assert.equal(request.body.tool_choice, undefined);
      }
    }
    const log = await page.evaluate(() => JSON.parse(localStorage.getItem("anvil-applog") || "[]"));
    assert.ok(log.some((row) => row.tag === "http" && row.msg.includes("POST") && row.msg.includes(provider === "ollama" ? "/api/chat" : "/responses")));
    assert.ok(log.some((row) => row.tag === "agent" && row.msg.includes("abgeschlossen")));
    assert.equal(JSON.stringify(log).includes("fixture-key"), false);
    assert.deepEqual(errors, []);
    if (mode === "ask" && process.env.ANVIL_QA_SCREENSHOTS) {
      await mkdir(process.env.ANVIL_QA_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.ANVIL_QA_SCREENSHOTS, production ? "chat-production.png" : "chat-dev.png") });
    }
    console.log(`${production ? "PRODUCTION" : "STALLED_HELPER"}_${label}_${mode.toUpperCase()}_SEND_OK`);
    await page.close();
  }

  {
    const { page, errors } = await openChat("ollama", "agent");
    const before = requests.length;
    await send(page, "fixture-tool-round: Lies README.md mit read_file und bestätige dann den Inhalt.");
    await answered(page, "LAN");
    const sent = requests.slice(before);
    assert.equal(sent.length, 2);
    assert.ok(sent[0].body.tools.some((tool) => tool.function.name === "read_file"));
    const history = sent[1].body.messages;
    assert.ok(history.some((message) => message.role === "assistant" && message.tool_calls?.[0]?.function.arguments.path === "README.md"));
    assert.ok(history.some((message) => message.role === "tool" && message.tool_name === "read_file" && message.content.includes("Fixture documentation")));
    assert.deepEqual(errors, []);
    console.log("OLLAMA_NATIVE_TOOL_HISTORY_ROUND_OK");
    await page.close();
  }

  {
    const { page, errors } = await openChat("ollama", "agent");
    await send(page, "fixture-http-error");
    await page.waitForFunction(() => !window.__anvilIde.getState().agentBusy && window.__anvilIde.getState().chat.some((m) => m.role === "assistant" && m.content));
    const log = await page.evaluate(() => JSON.parse(localStorage.getItem("anvil-applog") || "[]"));
    assert.ok(log.some((row) => row.tag === "http" && row.msg.includes("HTTP 404")));
    assert.ok(log.some((row) => row.tag === "agent" && row.msg.includes("fehlgeschlagen")));
    assert.equal(log.some((row) => row.tag === "agent" && row.msg.includes("abgeschlossen")), false);
    assert.deepEqual(errors, []);
    console.log("FAILED_REQUEST_LOG_OUTCOME_OK");
    await page.close();
  }

  if (!production) {
    const { page, errors } = await openChat("ollama", "agent", true);
    const before = requests.length;
    await send(page, "analysiere bitte das gesamte Projekt", true);
    assert.equal(await page.evaluate(() => window.__anvilIde.getState().agentBusy), true, "send must enter preparation before Stop");
    await page.getByRole("button", { name: "Abbrechen", exact: true }).dispatchEvent("click");
    await page.clock.resume();
    await page.waitForFunction(() => !window.__anvilIde.getState().agentBusy);
    await page.waitForFunction(() => !window.fixtureBrain.getState().busy);
    assert.equal(requests.length, before, "stopped preparation must not call the model");
    await send(page, "hi wer bist du");
    await answered(page, "LAN");
    assert.equal(requests.length, before + 1, "only the retry may reach the model");
    assert.deepEqual(errors, []);
    console.log("STOP_DURING_HELPER_AND_RETRY_OK");
    await page.close();
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  pipe.closeAllConnections();
  pipe.close();
  upstream.closeAllConnections();
  upstream.close();
  if (server) {
    if (production) await new Promise((resolve) => server.httpServer.close(resolve));
    else await server.close();
  }
}
