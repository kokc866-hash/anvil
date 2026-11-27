import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import path from "node:path";
import { createServer as httpServer } from "node:http";
import { fork } from "node:child_process";
import { createServer } from "vite";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { AgentJobHost } from "../electron/agent-job-host.mjs";
import { buildAgentRuntime } from "./build-agent-runtime.mjs";

const evidenceRoot = path.resolve("artifacts/cursor-adoption-2026-10-19/review/integration");
const sse = (choice) =>
  "data: " +
  JSON.stringify({
    choices: [
      {
        delta: choice.tool_calls
          ? { tool_calls: choice.tool_calls.map((call, index) => ({ index, ...call })) }
          : { content: choice.content },
        finish_reason: choice.tool_calls ? "tool_calls" : "stop",
      },
    ],
  }) +
  "\n\ndata: [DONE]\n\n";
const call = (name, args) => ({
  tool_calls: [
    {
      id: crypto.randomUUID(),
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    },
  ],
});
function modelChoice(_turn, review, offered, messages) {
  if (!offered.includes("review_submit"))
    return call("select_tools", { names: ["review_submit", "review_read_baseline"] });
  const calls = messages
    .flatMap((message) => message.tool_calls ?? [])
    .map((call) => call.function.name);
  if (!calls.includes("read_file")) return call("read_file", { path: "main.ts" });
  if (!calls.includes("review_submit"))
    return call("review_submit", {
      reviewId: review.id,
      files: [
        {
          path: "main.ts",
          status: "reviewed",
          findings: [
            {
              line: 1,
              title: "Synthetic integration finding",
              detail:
                "This observation exercises the product route; it is not an expert model verdict.",
            },
          ],
        },
      ],
    });
  return {
    content:
      "Synthetic connected review: current source read and report recorded. Functional behavior was not tested.",
  };
}
async function setup(t, responder) {
  await fs.mkdir(evidenceRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(evidenceRoot, "case-"));
  const globals = ["window", "document", "localStorage", "indexedDB", "IDBKeyRange", "fetch"];
  const before = globals.map((key) => [key, Object.hasOwn(globalThis, key), globalThis[key]]);
  const values = new Map(),
    timers = new Set(),
    requests = [];
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
  globalThis.window = Object.assign(new EventTarget(), {
    localStorage,
    setTimeout: (fn, ms) => {
      const timer = setTimeout(fn, ms);
      timers.add(timer);
      return timer;
    },
    clearTimeout,
    setInterval: (fn, ms) => {
      const timer = setInterval(fn, ms);
      timers.add(timer);
      return timer;
    },
    clearInterval,
    location: {
      pathname: "/",
      origin: "http://127.0.0.1:1",
      hostname: "127.0.0.1",
      protocol: "http:",
    },
  });
  globalThis.document = Object.assign(new EventTarget(), {
    visibilityState: "visible",
    documentElement: { lang: "de" },
    getElementById: () => null,
  });
  globalThis.fetch = async (url, init) => {
    const target =
      String(url) === "/__lan" ? new Headers(init.headers).get("x-anvil-target") : String(url);
    assert.ok(
      target.startsWith("http://127.0.0.1:19381/"),
      "No real model, remote service or private endpoint is allowed: " + target,
    );
    if (String(url).endsWith("/models"))
      return new Response(JSON.stringify({ data: [{ id: "synthetic-review" }] }), {
        headers: { "content-type": "application/json" },
      });
    const payload = JSON.parse(init.body);
    requests.push(payload);
    const result = await responder(payload, requests.length);
    return new Response(sse(result), {
      headers: { "content-type": "text/event-stream", "x-anvil-lan": "1" },
    });
  };
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    cacheDir: path.join(root, "vite-cache"),
    resolve: { alias: { "@": path.resolve("src") } },
    optimizeDeps: { noDiscovery: true, include: [] },
    ssr: {
      external: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "zustand",
        "zustand/vanilla",
        "zustand/middleware",
        "js-yaml",
        "fake-indexeddb",
      ],
    },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
  });
  t.after(async () => {
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const persistence = await server.ssrLoadModule("/src/lib/persist-storage.ts");
      await persistence.flushPersistence();
    } finally {
      for (const timer of timers) {
        clearTimeout(timer);
        clearInterval(timer);
      }
      await server.close();
      for (const [key, exists, value] of before) {
        if (exists) globalThis[key] = value;
        else delete globalThis[key];
      }
    }
  });
  const { useIde } = await server.ssrLoadModule("/src/store/ide.ts");
  await useIde.persist.rehydrate();
  const { useBrain } = await server.ssrLoadModule("/src/lib/brain/store.ts");
  useBrain.setState({
    on: false,
    autoLoad: false,
    autonomy: "off",
    jobs: Object.fromEntries(Object.keys(useBrain.getState().jobs).map((key) => [key, false])),
  });
  const { useIntern } = await server.ssrLoadModule("/src/lib/intern.ts");
  useIntern.getState().setPrefs({ on: false, autoHeal: false });
  const { useLearn } = await server.ssrLoadModule("/src/lib/learn.ts");
  await useLearn.persist.rehydrate();
  useLearn.setState({ on: false });
  const store = await server.ssrLoadModule("/src/lib/task-review-store.ts");
  await store.useTaskReviews.persist.rehydrate();
  useIde.setState({
    workspaceCwd: "",
    memoryWorkspace: "synthetic-review-project",
    workspaceEpoch: 1,
    files: { "main.ts": "export const answer = 2;", "other.ts": "export const other = 2;" },
    dirs: [],
    activePath: "main.ts",
    openPaths: ["main.ts"],
    dirty: {},
    editBases: {},
    pendingDiffs: [],
    checkpoints: [],
    attached: [],
    chat: [],
    agentJob: null,
    agentBusy: false,
    agentInbox: null,
    agentQueue: [],
    agentMode: "ask",
    autoSaveDisk: false,
    backgroundAgent: false,
    autoRunAgent: false,
    autoPreview: false,
    runLoop: false,
    testLoop: false,
    graphLoop: false,
    engineLoop: false,
    harnessMaxRounds: 16,
    harnessAutoContinue: false,
    harnessAfterWrite: "none",
    llmContextAuto: false,
    llmContext: 131072,
    llmProvider: "custom",
    llmAuthMode: "key",
    llmBaseUrl: "http://127.0.0.1:19381/v1",
    llmModel: "synthetic-review",
    llmApiKey: "",
    llmThinking: "off",
    llmRetries: 1,
    llmCompact: "off",
    llmToolLearning: {},
    llmToolModes: {},
    mcpServers: [],
    activeSurfaceId: "anvil",
    surfaceMode: "bridge",
    locale: "de",
    agentRules: "",
  });
  const review = await server.ssrLoadModule("/src/lib/task-review.ts");
  return { root, server, useIde, requests, ...store, ...review };
}

test(
  "Foreground sendChat records actual read coverage through the real client and project review store",
  { timeout: 60000 },
  async (t) => {
    let request;
    const f = await setup(t, (payload, turn) =>
      modelChoice(
        turn,
        request,
        payload.tools?.map((tool) => tool.function.name) ?? [],
        payload.messages,
      ),
    );
    request = await f.createReviewRequest({
      project: f.useIde.getState().memoryWorkspace,
      baselineFiles: {
        "main.ts": "export const answer = 1;",
        "other.ts": "export const other = 1;",
      },
      files: f.useIde.getState().files,
    });
    f.beginTaskReview(request);
    const { sendChat } = await f.server.ssrLoadModule("/src/lib/chat-session.ts");
    const input = {
      draft: f.buildReviewPrompt(request),
      images: [],
      title: "Synthetic review",
      setTitle() {},
      setDraft() {},
      setImages() {},
      setMention() {},
    };
    await sendChat(input);
    assert.ok(f.requests.length >= 3, JSON.stringify(f.useIde.getState().chat));
    const stored = f.useTaskReviews.getState().requests.find((item) => item.id === request.id);
    assert.equal(
      stored.files.find((file) => file.path === "main.ts").status,
      "reviewed",
      JSON.stringify(f.useIde.getState().chat.at(-1)),
    );
    assert.equal(stored.files.find((file) => file.path === "other.ts").status, "open");
    assert.equal(stored.files[0].evidence.length, 1);
    assert.equal(
      stored.files[0].evidence[0].stamp,
      await f.reviewFileStamp(f.useIde.getState().files["main.ts"]),
    );
    assert.equal(f.useIde.getState().files["main.ts"], "export const answer = 2;");
    assert.equal(f.useIde.getState().agentBusy, false);
    assert.equal(f.reviewForPrompt(f.buildReviewPrompt(request), "other-project"), undefined);
    await fs.writeFile(
      path.join(f.root, "foreground-review.json"),
      JSON.stringify(
        {
          syntheticModel: true,
          report: stored,
          requests: f.requests.map((row) => ({
            tools: row.tools?.map((tool) => tool.function.name),
            messages: row.messages.length,
          })),
        },
        null,
        2,
      ),
    );
  },
);

test(
  "An editor change during foreground review is stored as stale instead of current coverage",
  { timeout: 60000 },
  async (t) => {
    let request,
      f,
      edited = false;
    f = await setup(t, (payload, turn) => {
      const choice = modelChoice(
        turn,
        request,
        payload.tools?.map((tool) => tool.function.name) ?? [],
        payload.messages,
      );
      if (choice.tool_calls?.[0]?.function.name === "review_submit") {
        edited = true;
        f.useIde.setState({
          files: { ...f.useIde.getState().files, "main.ts": "edited while review was running" },
        });
      }
      return choice;
    });
    request = await f.createReviewRequest({
      project: f.useIde.getState().memoryWorkspace,
      baselineFiles: { "main.ts": "before" },
      files: f.useIde.getState().files,
      paths: ["main.ts"],
    });
    f.beginTaskReview(request);
    const { sendChat } = await f.server.ssrLoadModule("/src/lib/chat-session.ts");
    await sendChat({
      draft: f.buildReviewPrompt(request),
      images: [],
      title: "Synthetic concurrent edit",
      setTitle() {},
      setDraft() {},
      setImages() {},
      setMention() {},
    });
    assert.equal(edited, true);
    const stored = f.useTaskReviews.getState().requests.find((item) => item.id === request.id);
    assert.equal(
      stored.files[0].status,
      "stale",
      "The current editor differs from the captured run snapshot",
    );
    assert.equal(f.useIde.getState().files["main.ts"], "edited while review was running");
  },
);

test(
  "Background worker reports native read coverage through host storage and renderer reattachment",
  { timeout: 90000 },
  async (t) => {
    const f = await setup(t, () => {
      throw Error("Worker must use its isolated local HTTP responder.");
    });
    const project = f.useIde.getState().memoryWorkspace;
    const review = await f.createReviewRequest({
      project,
      baselineFiles: { "main.ts": "export const answer = 1;" },
      files: { "main.ts": "export const answer = 2;" },
    });
    f.beginTaskReview(review);
    const build = path.join(f.root, "runtime");
    await buildAgentRuntime(build);
    const payloads = [];
    const api = httpServer(async (req, res) => {
      try {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const payload = JSON.parse(raw);
        payloads.push(payload);
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(
          sse(
            modelChoice(
              payloads.length,
              review,
              payload.tools?.map((tool) => tool.function.name) ?? [],
              payload.messages,
            ),
          ),
        );
      } catch (error) {
        res.writeHead(500).end(String(error.message));
      }
    });
    await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
    const operations = [];
    const snapshotPath = path.join(f.root, "job", "latest.json");
    const host = new AgentJobHost({
      snapshotPath,
      runtime: {
        begin() {},
        close() {},
        finish() {},
        async execute(op) {
          operations.push(op);
          if (op.kind !== "workflow") throw Error("Review may not execute a project action.");
          return { ok: true };
        },
      },
      launch: () =>
        fork(path.join(build, "worker.mjs"), [], { stdio: ["ignore", "ignore", "inherit", "ipc"] }),
    });
    t.after(async () => {
      await host.close();
      api.closeAllConnections();
      await new Promise((resolve) => api.close(resolve));
    });
    host.start({
      project,
      review,
      execution: true,
      files: { "main.ts": "export const answer = 2;" },
      messages: [{ role: "user", content: f.buildReviewPrompt(review) }],
      maxRounds: 16,
      autoContinue: false,
      locale: "de",
      plan: [],
      model: {
        provider: "custom",
        baseUrl: `http://127.0.0.1:${api.address().port}/v1`,
        model: "synthetic-review-worker",
        context: 131072,
        thinking: "off",
        maxOut: 2000,
        hardStopMin: 1,
      },
    });
    for (let i = 0; i < 1000 && host.busy(); i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(host.busy(), false, JSON.stringify(host.state));
    assert.equal(host.state.status, "done", host.state.error);
    assert.ok(host.state.review, "Validated worker review must reach the persistent host state");
    assert.equal(host.state.review.files[0].status, "reviewed", JSON.stringify(host.state));
    assert.equal(
      host.state.review.files[0].evidence[0].stamp,
      await f.reviewFileStamp("export const answer = 2;"),
    );
    assert.ok(!operations.some((op) => ["write", "run", "shell"].includes(op.kind)));
    for (let i = 0; i < 100 && !host.state.reviewArtifact && !host.state.reviewArtifactError; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(
      host.state.reviewArtifact,
      host.state.reviewArtifactError || "Review artifact must survive outside the job snapshot",
    );
    const storedArtifact = await host.reviewArtifacts.read({
      project,
      jobId: host.state.id,
      id: host.state.reviewArtifact.id,
      jobVersion: host.state.reviewArtifact.jobVersion,
      fileStamps: { "main.ts": await f.reviewFileStamp("export const answer = 2;") },
    });
    assert.equal(storedArtifact.status, "ready");
    assert.equal(storedArtifact.freshness, "current");
    assert.equal(JSON.parse(storedArtifact.data.toString()).id, review.id);
    assert.equal(
      (
        await host.reviewArtifacts.read({
          project,
          jobId: host.state.id,
          id: host.state.reviewArtifact.id,
          fileStamps: {},
        })
      ).status,
      "stale",
    );
    const bg = await f.server.ssrLoadModule("/src/lib/background-agent.ts");
    window.anvilNative = {
      agentJob: async (action) => (action === "status" ? host.snapshot() : { available: true }),
    };
    const stop = bg.startBackgroundAgentMonitor();
    try {
      for (let i = 0; i < 100 && f.useTaskReviews.getState().requests[0].revision === 0; i++)
        await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(
        f.useTaskReviews.getState().requests[0].files[0].status,
        "reviewed",
        "Renderer reattachment must use real saveTaskReview",
      );
    } finally {
      stop();
    }
    host.persist();
    const reopened = new AgentJobHost({ snapshotPath, runtime: {} });
    assert.equal(reopened.state.review.files[0].status, "reviewed");
    await reopened.close();
    await fs.writeFile(
      path.join(f.root, "background-review.json"),
      JSON.stringify(
        { syntheticModel: true, state: host.state, modelRequests: payloads.length },
        null,
        2,
      ),
    );
  },
);

test(
  "Embedded review UI queues one bounded finding task and disables a stale finding",
  { timeout: 60000 },
  async (t) => {
    const { chromium } = await import("playwright");
    await fs.mkdir(evidenceRoot, { recursive: true });
    const root = await fs.mkdtemp(path.join(evidenceRoot, "ui-"));
    const html = `<!doctype html><html lang="de"><meta charset="utf-8"><link rel="icon" href="data:,"><title>Review interaction fixture</title>
    <style>body{margin:0;padding:24px;max-width:520px;background:#17212b;color:#f5f7fa;font:14px sans-serif}button,select,textarea{font:inherit}button{cursor:pointer}textarea,select{display:block;width:100%;box-sizing:border-box;margin:8px 0}li{list-style:none;border:1px solid #536171;padding:12px;margin:8px 0}button{margin:6px 0}details{padding:8px}</style>
    <div id="root"></div><script type="module">
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {TaskReviewPane} from '/src/components/ide/task-review-pane.tsx';
    import {useIde} from '/src/store/ide.ts';
    import {useTaskReviews,beginTaskReview,saveTaskReview} from '/src/lib/task-review-store.ts';
    import {createReviewRequest,applyReviewReport,reviewFileStamp} from '/src/lib/task-review.ts';
    await useIde.persist.rehydrate(); await useTaskReviews.persist.rehydrate();
    useIde.setState({workspaceCwd:'',memoryWorkspace:'synthetic-ui-review',workspaceEpoch:1,files:{'main.ts':'export const answer = 2;'},dirs:[],activePath:'main.ts',editBases:{'main.ts':'export const answer = 1;'},dirty:{'main.ts':true},checkpoints:[],agentMode:'ask',agentBusy:false,agentInbox:null,agentQueue:[],agentJob:null,chat:[],autoSaveDisk:false});
    const request=await createReviewRequest({project:'synthetic-ui-review',baselineFiles:{'main.ts':'export const answer = 1;'},files:useIde.getState().files});
    beginTaskReview(request);
    const reviewed=await applyReviewReport(request,{files:[{path:'main.ts',status:'reviewed',findings:[{line:1,title:'Synthetic visible finding',detail:'Only the artificial answer declaration is in scope.'}]}]},
      {files:useIde.getState().files,reads:[{path:'main.ts',stamp:await reviewFileStamp(useIde.getState().files['main.ts']),from:1,to:1,total:1,evidenceId:'ui-native-read'}]});
    saveTaskReview(reviewed);window.__reviewFixture={useIde,useTaskReviews,reviewId:request.id};
    createRoot(document.getElementById('root')).render(React.createElement(TaskReviewPane));
    </script></html>`;
    const server = await createServer({
      configFile: false,
      root: process.cwd(),
      cacheDir: path.join(root, "vite-cache"),
      resolve: { alias: { "@": path.resolve("src") } },
      optimizeDeps: {
        noDiscovery: true,
        include: [
          "react",
          "react-dom",
          "react-dom/client",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
          "zustand",
          "zustand/vanilla",
          "zustand/middleware",
        ],
      },
      server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
      appType: "custom",
      plugins: [
        {
          name: "review-ui-fixture",
          configureServer(server) {
            server.middlewares.use("/__review_fixture", async (_req, res, next) => {
              try {
                res.setHeader("content-type", "text/html");
                res.end(await server.transformIndexHtml("/__review_fixture", html));
              } catch (error) {
                next(error);
              }
            });
          },
        },
      ],
    });
    await server.listen();
    let browser;
    t.after(async () => {
      await browser?.close();
      await server.close();
    });
    browser = await chromium.launch({
      headless: true,
      ...(process.platform === "win32" ? { channel: "msedge" } : {}),
    });
    const page = await browser.newPage({ viewport: { width: 520, height: 1200 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__review_fixture`);
    await page.locator('[data-testid="task-review-pane"] summary').click();
    await page.locator('[data-review-status="reviewed"]').waitFor();
    await page.getByRole("button", { name: "Nur diesen Befund bearbeiten" }).click();
    await page.waitForFunction(() => window.__reviewFixture.useIde.getState().agentInbox !== null);
    const queued = await page.evaluate(() => window.__reviewFixture.useIde.getState().agentInbox);
    assert.equal(queued.mode, "agent");
    assert.match(queued.text, /Nur diesen Befund in main\.ts:1/);
    assert.doesNotMatch(queued.text, /\[anvil-review:/);
    await page.evaluate(() => {
      const f = window.__reviewFixture;
      f.useIde.setState({ agentInbox: null, files: { "main.ts": "changed after review" } });
    });
    await page.locator('[data-review-status="stale"]').waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Nur diesen Befund bearbeiten" }).isDisabled(),
      true,
    );
    assert.match(await page.locator('[data-testid="review-coverage"]').textContent(), /1 veraltet/);
    await page.screenshot({ path: path.join(root, "review-stale.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: path.join(root, "review-stale-narrow.png"), fullPage: true });
    await page.evaluate(() =>
      window.__reviewFixture.useIde.setState({ files: { "main.ts": "export const answer = 2;" } }),
    );
    await page.getByRole("button", { name: "Prüfung starten", exact: true }).click();
    await page.waitForFunction(
      () => window.__reviewFixture.useIde.getState().agentInbox?.mode === "ask",
    );
    const explicit = await page.evaluate(() => window.__reviewFixture.useIde.getState().agentInbox);
    assert.match(explicit.text, /^\[anvil-review:/);
    assert.equal(explicit.mode, "ask");
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(root, "ui-result.json"),
      JSON.stringify(
        { synthetic: true, queued, explicit: { mode: explicit.mode, hasMarker: true }, errors },
        null,
        2,
      ),
    );
  },
);
