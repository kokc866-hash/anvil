import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createServer } from "vite";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

test("native project selection does not depend on the previous folder being accessible", async (t) => {
  const base = "http://127.0.0.1:7845";
  const missing = "I:/anvil-qa/workspace-missing";
  const existing = "I:/anvil-qa/workspace-existing";
  const rejected = "I:/anvil-qa/workspace-rejected";
  const oldFiles = { "before.txt": "Previous editor state" };
  const newFiles = { "opened.txt": "Selected folder" };
  const requests = [];
  const nativeRequests = [];
  const memory = new Map();
  const globals = ["window", "document", "localStorage", "indexedDB", "IDBKeyRange", "fetch"];
  const descriptors = Object.fromEntries(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const storage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: (key) => memory.delete(key),
  };
  let picked = existing;
  let leases = 0;
  globalThis.window = Object.assign(new EventTarget(), {
    localStorage: storage,
    setTimeout: (fn, delay) => setTimeout(fn, delay).unref(),
    clearTimeout,
    anvilNative: {
      workspacePick: async () => picked,
      companionEnsure: async () => { leases++; return { ok: true }; },
      companionRelease: async () => { leases--; },
    },
  });
  globalThis.document = Object.assign(new EventTarget(), { documentElement: { lang: "de" } });
  globalThis.localStorage = storage;
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
  globalThis.fetch = async (url, options) => {
    const route = new URL(url);
    assert.equal(route.origin, base);
    if (route.pathname === "/v1/workspace") {
      const { cwd } = JSON.parse(options.body);
      requests.push(["workspace", cwd]);
      return Response.json(cwd === existing
        ? { ok: true, cwd }
        : { ok: false, error: "Ordner fehlt." });
    }
    if (route.pathname === "/v1/tree") {
      requests.push(["tree", route.searchParams.get("cwd")]);
      return Response.json({ ok: true, files: newFiles, dirs: [], n: 1 });
    }
    throw Error("Unexpected test request " + route.pathname);
  };

  const vite = await createServer({
    configFile: false,
    root: process.cwd(),
    resolve: { alias: { "@": path.resolve("src") } },
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: "custom",
  });
  t.after(async () => {
    try {
      await vite.ssrLoadModule("/src/lib/persist-storage.ts").then((module) => module.flushPersistence());
      await vite.close();
    } finally {
      for (const key of globals) {
        if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key]);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
  const { useIde } = await vite.ssrLoadModule("/src/store/ide.ts");
  await useIde.persist.rehydrate();
  const { openOsWorkspace } = await vite.ssrLoadModule("/src/lib/workspace-open.ts");
  function seed() {
    useIde.setState({
      workspaceCwd: missing, workspaceNative: false, companionUrl: base, workspaceEpoch: 12, diskName: "workspace-missing",
      files: oldFiles, dirty: {}, dirs: [], pendingDiffs: [], agentBusy: false, companionKeep: false,
      pathOperation: null, activePath: "before.txt", openPaths: ["before.txt"],
    });
    requests.length = 0;
  }

  await t.test("valid selected folder replaces the old missing folder", async () => {
    seed();
    assert.deepEqual(await openOsWorkspace(), { ok: true, cwd: existing, n: 1, skipped: undefined });
    assert.deepEqual(requests, [["workspace", existing], ["tree", existing]]);
    const state = useIde.getState();
    assert.equal(state.workspaceCwd, existing);
    assert.deepEqual(state.files, newFiles);
    assert.equal(state.activePath, "opened.txt");
    assert.equal(state.pathOperation, null);
    assert.equal(leases, 0);
  });

  await t.test("rejected destination leaves the original editor intact", async () => {
    seed();
    picked = rejected;
    const result = await openOsWorkspace();
    assert.equal(result.ok, false);
    assert.equal(result.error, "Ordner fehlt.");
    assert.deepEqual(requests, [["workspace", rejected]]);
    const state = useIde.getState();
    assert.equal(state.workspaceCwd, missing);
    assert.equal(state.workspaceEpoch, 12);
    assert.equal(state.files, oldFiles);
    assert.equal(state.activePath, "before.txt");
    assert.equal(state.pathOperation, null);
    assert.equal(leases, 0);
  });

  await t.test("desktop opens and saves a fresh project using only the native disk bridge", async () => {
    seed();
    picked = existing;
    const browser = globalThis.window;
    const before = {
      memoryWorkspace: "v2:path:i:/anvil-qa/workspace-missing",
      chat: [{ id: "old-chat", role: "user", content: "Only belongs to the previous project" }],
    };
    useIde.setState({ ...before, companionUrl: "http://127.0.0.1:1", workspaceSessions: {}, autoSaveDisk: false });
    let stored = newFiles["opened.txt"];
    browser.anvilNative.workspaceDisk = async (request) => {
      nativeRequests.push(request);
      assert.equal(request.root, existing);
      if (request.action === "tree") return { ok: true, cwd: existing, files: newFiles, dirs: [], n: 1, skipped: 0 };
      if (request.action === "empty") return { ok: true, empty: false };
      if (request.action === "write") {
        assert.equal(request.expected, stored);
        stored = request.content;
        return { ok: true };
      }
      if (request.action === "read") return { ok: true, files: { "opened.txt": stored } };
      throw new Error(`Unexpected native request ${request.action}`);
    };
    const fetchBefore = globalThis.fetch;
    let networkAttempts = 0;
    globalThis.fetch = async () => { networkAttempts++; throw new Error("Unexpected network request"); };
    try {
      assert.equal((await openOsWorkspace()).ok, true);
      const state = useIde.getState();
      assert.equal(state.workspaceNative, true);
      assert.equal(state.workspaceCwd, existing);
      assert.notEqual(state.memoryWorkspace, before.memoryWorkspace);
      assert.deepEqual(state.chat, []);
      assert.deepEqual(state.workspaceSessions[before.memoryWorkspace].chat, before.chat);
      assert.equal(state.companionUrl, "http://127.0.0.1:1");
      assert.equal(leases, 0);
      state.setContent("opened.txt", "Saved without a connection");
      const { syncWrite, readDiskTargetFiles, captureDiskTarget } = await vite.ssrLoadModule("/src/lib/disk-sync.ts");
      await syncWrite("opened.txt", "Saved without a connection");
      assert.equal(stored, "Saved without a connection");
      assert.deepEqual(await readDiskTargetFiles(["opened.txt"], captureDiskTarget()), { "opened.txt": stored });
      assert.equal(useIde.getState().dirty["opened.txt"], undefined);
      assert.deepEqual(nativeRequests.map(({ action }) => action), ["tree", "empty", "write", "read"]);
      assert.equal(networkAttempts, 0);
    } finally {
      globalThis.fetch = fetchBefore;
    }
  });

  await t.test("an empty local folder opens a fresh conversation without discarding its saved task", async () => {
    seed();
    const oldChat = [{ id: "previous-qa", role: "assistant", content: "Earlier project", steps: [{ id: "step", name: "run_file", status: "ok" }] }];
    useIde.setState({
      workspaceCwd: existing, workspaceNative: true, workspaceEmpty: false, chat: oldChat,
      workspaceSessions: {}, agentDraft: "", pendingAsk: null, agentInbox: null, agentQueue: [],
      dirty: {}, editBases: {}, pendingDiffs: [], checkpoints: [], running: false, testsRunning: false,
    });
    let empty = false;
    let selectedJobId = "old-job";
    const jobs = [{ jobId: selectedJobId, project: existing, status: "done", busy: false }];
    const native = window.anvilNative;
    const actions = [];
    native.workspaceDisk = async request => {
      assert.deepEqual(request, { action: "empty", root: existing });
      return { ok: true, empty };
    };
    native.agentJob = async (action, payload) => {
      actions.push(action);
      if (action === "jobs") return { selectedJobId, jobs };
      assert.equal(action, "select");
      assert.deepEqual(payload, { jobId: "", expectedJobId: "old-job" });
      selectedJobId = "";
      return { state: null, jobId: "", selectedJobId };
    };
    const { checkEmptyLocalWorkspace } = await vite.ssrLoadModule("/src/lib/workspace-empty.ts");
    await checkEmptyLocalWorkspace();
    assert.equal(useIde.getState().chat, oldChat);
    assert.deepEqual(actions, []);

    empty = true;
    useIde.setState({ dirty: { "before.txt": true } });
    await checkEmptyLocalWorkspace();
    assert.equal(useIde.getState().chat, oldChat);
    assert.deepEqual(actions, []);
    useIde.setState({ dirty: {} });
    await checkEmptyLocalWorkspace();
    const current = useIde.getState();
    assert.equal(current.workspaceEmpty, true);
    assert.deepEqual(current.chat, []);
    assert.deepEqual(current.files, {});
    assert.deepEqual(current.openPaths, []);
    assert.deepEqual(Object.values(current.workspaceSessions)[0].chat, oldChat);
    assert.deepEqual(actions, ["jobs", "select"]);
    assert.deepEqual(jobs.map(job => job.jobId), ["old-job"]);

    const newChat = [{ id: "new-qa", role: "user", content: "A chat started while the folder is empty" }];
    useIde.setState({ chat: newChat });
    await checkEmptyLocalWorkspace();
    assert.deepEqual(useIde.getState().chat, newChat);
    assert.deepEqual(actions, ["jobs", "select"]);
  });

});
