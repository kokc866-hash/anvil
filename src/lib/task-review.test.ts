import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  applyReviewReport,
  buildReviewPrompt,
  createReviewRequest,
  refreshReviewRequest,
  reviewFileStamp,
  reviewFindingPrompt,
  reviewSummary,
  validateReviewRequest,
  resolveReviewPrompt,
  type ReviewReadEvidence,
  type ReviewRequest,
} from "./task-review.ts";

async function fixture() {
  const baselineFiles = { "a.ts": "one\ntwo\nthree", "b.ts": "old", "deleted.ts": "gone" };
  const files = { "a.ts": "one\nchanged\nthree", "b.ts": "new", "added.ts": "" };
  const request = await createReviewRequest({
    project: "project-a",
    baselineFiles,
    files,
    basisLabel: "Gespeicherter Ausgangsstand",
  });
  return { request, files, baselineFiles };
}
async function read(
  path: string,
  content: string,
  from = 1,
  to = content.split("\n").length,
  id = `read:${path}:${from}`,
): Promise<ReviewReadEvidence> {
  return {
    path,
    stamp: await reviewFileStamp(content),
    from,
    to,
    total: content.split("\n").length,
    evidenceId: id,
  };
}

test("Review binds exact UTF-8 bytes, explicit baseline and all changed targets", async () => {
  for (const content of ["", "hello", "ä😀\r\nend", "\ud800"])
    assert.equal(
      await reviewFileStamp(content),
      createHash("sha256").update(content).digest("hex"),
    );
  const { request } = await fixture();
  assert.equal(request.project, "project-a");
  assert.equal(request.basisLabel, "Gespeicherter Ausgangsstand");
  assert.deepEqual(
    request.files.map((f) => [f.path, f.change, f.status]),
    [
      ["a.ts", "modified", "open"],
      ["added.ts", "added", "open"],
      ["b.ts", "modified", "open"],
      ["deleted.ts", "removed", "open"],
    ],
  );
  assert.equal(request.files[0].baseline?.content, "one\ntwo\nthree");
  assert.match(buildReviewPrompt(request), new RegExp(`^\\[anvil-review:${request.id}\\]`, "m"));
  assert.equal(reviewSummary(request).status, "open");
});

test("Partial reports close only fully read current bytes and leave absent files open", async () => {
  const { request, files } = await fixture();
  const result = await applyReviewReport(
    request,
    {
      reviewId: request.id,
      files: [
        {
          path: "a.ts",
          status: "reviewed",
          findings: [
            {
              line: 2,
              title: "Fehlender Rückgabewert",
              detail: "Der Wert geht in diesem Zweig verloren.",
            },
          ],
        },
        { path: "b.ts", status: "skipped", reason: "Separater Prüfbereich" },
        { path: "unbekannt.ts", status: "reviewed" },
      ],
    },
    {
      files,
      reads: [await read("a.ts", files["a.ts"], 1, 1), await read("a.ts", files["a.ts"], 2, 3)],
    },
  );
  assert.equal(result.files[0].status, "reviewed");
  assert.equal(result.files[0].findings.length, 1);
  assert.deepEqual(reviewSummary(result), {
    total: 4,
    reviewed: 1,
    skipped: 1,
    open: 2,
    stale: 0,
    findings: 1,
    status: "limited",
  });
  assert.equal(result.files.find((f) => f.path === "added.ts")?.status, "open");
  assert.match(result.reportWarnings.join(" "), /unbekannt/);
  assert.equal(request.files[0].status, "open", "Input request remains immutable");
});

test("Missing, gapped, forged-ID, wrong-total, failed and stale read evidence cannot close a file", async () => {
  const { request, files } = await fixture();
  const complete = await read("a.ts", files["a.ts"]);
  const cases: ReviewReadEvidence[][] = [
    [],
    [await read("a.ts", files["a.ts"], 1, 1), await read("a.ts", files["a.ts"], 3, 3)],
    [{ ...complete, stamp: await reviewFileStamp("old") }],
    [{ ...complete, total: 4 }],
    [{ ...complete, from: 0 }],
    [{ ...complete, to: 4 }],
    [{ ...complete, evidenceId: "bad\nID" }],
    [{ ...complete, ok: false }],
    [
      { ...complete, from: 1, to: 1 },
      { ...complete, from: 2, to: 3 },
    ],
  ];
  for (const reads of cases) {
    const result = await applyReviewReport(
      request,
      { files: [{ path: "a.ts", status: "reviewed" }] },
      { files, reads },
    );
    assert.equal(result.files[0].status, "open", JSON.stringify(reads));
    assert.equal(reviewSummary(result).reviewed, 0);
  }
  const result = await applyReviewReport(
    request,
    { files: [{ path: "a.ts", status: "reviewed" }] },
    { files: { ...files, "a.ts": "changed again" }, reads: [complete] },
  );
  assert.equal(result.files[0].status, "stale");
});

test("A partial second report preserves valid coverage, a later edit makes it stale", async () => {
  const { request, files } = await fixture();
  const first = await applyReviewReport(
    request,
    { files: [{ path: "a.ts", status: "reviewed" }] },
    { files, reads: [await read("a.ts", files["a.ts"])] },
  );
  const second = await applyReviewReport(
    first,
    { files: [{ path: "b.ts", status: "reviewed" }] },
    { files, reads: [await read("b.ts", files["b.ts"])] },
  );
  assert.equal(reviewSummary(second).reviewed, 2);
  const stale = await refreshReviewRequest(second, { ...files, "a.ts": "later" });
  assert.equal(stale.files[0].status, "stale");
  assert.equal(reviewSummary(stale).reviewed, 1);
  assert.equal(
    (await refreshReviewRequest(second, { ...files, "deleted.ts": "resurrected" })).files.at(-1)
      ?.status,
    "stale",
  );
});

test("Deleted files require separate baseline evidence and an unchanged deletion", async () => {
  const { request, files, baselineFiles } = await fixture();
  const evidence = await read("deleted.ts", baselineFiles["deleted.ts"]);
  const report = { files: [{ path: "deleted.ts", status: "reviewed" as const }] };
  const current = await applyReviewReport(request, report, { files, reads: [evidence] });
  assert.equal(current.files.at(-1)?.status, "open");
  const baseline = await applyReviewReport(request, report, {
    files,
    reads: [{ ...evidence, source: "baseline" }],
  });
  assert.equal(baseline.files.at(-1)?.status, "reviewed");
  assert.match(baseline.files.at(-1)?.reason ?? "", /Vergleichsbasis/);
});

test("Review completion denotes documented coverage only, without approving functionality", async () => {
  const request = await createReviewRequest({
    project: "p",
    baselineFiles: { "a.ts": "old" },
    files: { "a.ts": "new" },
  });
  const result = await applyReviewReport(
    request,
    { files: [{ path: "a.ts", status: "reviewed" }] },
    { files: { "a.ts": "new" }, reads: [await read("a.ts", "new")] },
  );
  assert.equal(reviewSummary(result).status, "complete");
  assert.doesNotMatch(JSON.stringify(result), /"(accepted|approved|testsPassed|functional)":true/);
});

test("Report rejects wrong identities, duplicate files, invalid lines and oversized model data", async () => {
  const { request, files } = await fixture();
  const context = { files, reads: [] };
  await assert.rejects(
    applyReviewReport(request, { reviewId: "different", files: [] }, context),
    /Review-ID/,
  );
  await assert.rejects(
    applyReviewReport(
      request,
      {
        files: [
          { path: "a.ts", status: "skipped" },
          { path: "a.ts", status: "reviewed" },
        ],
      },
      context,
    ),
    /doppelt/,
  );
  await assert.rejects(
    applyReviewReport(
      request,
      {
        files: [
          { path: "a.ts", status: "reviewed", findings: [{ line: 4, title: "x", detail: "x" }] },
        ],
      },
      context,
    ),
    /Zeile/,
  );
  await assert.rejects(
    applyReviewReport(
      request,
      {
        files: [
          {
            path: "a.ts",
            status: "reviewed",
            findings: [{ line: 1, title: "x".repeat(241), detail: "x" }],
          },
        ],
      },
      context,
    ),
    /Titel/,
  );
  await assert.rejects(
    applyReviewReport(
      request,
      { files: [{ path: "a.ts", status: "skipped", reason: "ä".repeat(150_000) }] },
      context,
    ),
    /Budget/,
  );
  await assert.rejects(
    createReviewRequest({ project: "p", baselineFiles: {}, files: {}, paths: ["../escape"] }),
    /Dateipfad/,
  );
});

test("Missing baseline is explicit and secrets never become review input", async () => {
  const request = await createReviewRequest({
    project: "p",
    files: { "a.ts": "x", ".env": "PRIVATE" },
    paths: ["a.ts", ".env", "unknown.ts"],
  });
  assert.equal(request.baselineAvailable, false);
  assert.equal(request.files.find((f) => f.path === "a.ts")?.change, "unknown");
  assert.equal(request.files.find((f) => f.path === "unknown.ts")?.status, "open");
  assert.equal(
    request.files.some((f) => f.path === ".env"),
    false,
  );
  assert.doesNotMatch(buildReviewPrompt(request), /PRIVATE/);
});

test("Finding follow-up is restricted to one observed finding and cannot impersonate a review start", async () => {
  const { request, files } = await fixture();
  const result = await applyReviewReport(
    request,
    {
      files: [
        {
          path: "a.ts",
          status: "reviewed",
          findings: [{ line: 2, title: "Defect", detail: "Bounded issue" }],
        },
      ],
    },
    { files, reads: [await read("a.ts", files["a.ts"])] },
  );
  const finding = result.files[0].findings[0];
  const prompt = reviewFindingPrompt(result, "a.ts", finding.id);
  assert.match(prompt, /a\.ts:2/);
  assert.match(prompt, /Nur diesen Befund/);
  assert.doesNotMatch(prompt, /\[anvil-review:/);
  assert.throws(() => reviewFindingPrompt(result, "b.ts", finding.id), /Befund/);
  assert.equal(validateReviewRequest(result), true);
  assert.equal(validateReviewRequest({ ...result, id: "x\nwrong" }), false);
  assert.equal(
    validateReviewRequest({
      ...result,
      files: [...result.files, result.files[0]],
    } as ReviewRequest),
    false,
  );
});

test("Prompt markers bind only to existing IDs in the exact captured project", async () => {
  const { request } = await fixture();
  const prompt = buildReviewPrompt(request);
  assert.equal(resolveReviewPrompt(prompt, request.project, [request]), request);
  assert.equal(resolveReviewPrompt(prompt, "project-b", [request]), undefined);
  assert.equal(resolveReviewPrompt(prompt, request.project, []), undefined);
  assert.equal(
    resolveReviewPrompt(`${prompt}\n[anvil-review:unknown]`, request.project, [request]),
    undefined,
  );
  assert.equal(
    resolveReviewPrompt(`quoted [anvil-review:${request.id}]`, request.project, [request]),
    undefined,
  );
});

test("Project-bound partial reports merge, survive persistence and reject obsolete or foreign updates", async (t) => {
  const { createServer } = await import("vite");
  const { IDBFactory, IDBKeyRange } = await import("fake-indexeddb");
  const path = await import("node:path");
  const globals = globalThis as unknown as Record<string, unknown>;
  const names = ["window", "document", "localStorage", "indexedDB", "IDBKeyRange", "fetch"];
  const saved = new Map(
    names.map((name) => [name, { exists: Object.hasOwn(globals, name), value: globals[name] }]),
  );
  const values = new Map<string, string>(),
    timers = new Set<ReturnType<typeof setTimeout>>();
  globals.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  globals.indexedDB = new IDBFactory();
  globals.IDBKeyRange = IDBKeyRange;
  globals.window = Object.assign(new EventTarget(), {
    localStorage: globals.localStorage,
    setTimeout: (fn: () => void, ms: number) => {
      const id = setTimeout(fn, ms);
      timers.add(id);
      return id;
    },
    clearTimeout,
    location: {
      pathname: "/",
      origin: "http://127.0.0.1:1",
      protocol: "http:",
      hostname: "127.0.0.1",
    },
  });
  globals.document = new EventTarget();
  globals.fetch = async () => {
    throw Error("No network allowed in review integration test.");
  };
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    resolve: { alias: { "@": path.resolve("src") } },
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
  });
  t.after(async () => {
    try {
      const storage = await server.ssrLoadModule("/src/lib/persist-storage.ts");
      await storage.flushPersistence();
    } finally {
      timers.forEach(clearTimeout);
      await server.close();
      for (const [name, item] of saved) {
        if (item.exists) globals[name] = item.value;
        else delete globals[name];
      }
    }
  });
  const store = await server.ssrLoadModule("/src/lib/task-review-store.ts");
  await store.useTaskReviews.persist.rehydrate();
  const { request, files } = await fixture();
  store.beginTaskReview(request);
  assert.equal(store.reviewForPrompt(buildReviewPrompt(request), request.project).id, request.id);
  assert.equal(store.reviewForPrompt(buildReviewPrompt(request), "wrong-project"), undefined);
  await assert.rejects(
    store.storeReviewReport(
      { ...request, project: "wrong-project" },
      { files: [] },
      { files, reads: [] },
    ),
    /Projekt/,
  );
  await Promise.all([
    store.storeReviewReport(
      request,
      { files: [{ path: "a.ts", status: "reviewed" }] },
      { files, reads: [await read("a.ts", files["a.ts"])] },
    ),
    store.storeReviewReport(
      request,
      { files: [{ path: "b.ts", status: "reviewed" }] },
      { files, reads: [await read("b.ts", files["b.ts"])] },
    ),
  ]);
  const current = store.useTaskReviews.getState().requests[0];
  assert.equal(reviewSummary(current).reviewed, 2);
  assert.equal(current.revision, 2);
  assert.throws(() => store.saveTaskReview(request), /überholt/);
  const persistence = await server.ssrLoadModule("/src/lib/persist-storage.ts");
  await persistence.flushPersistence();
  const restarted = await server.ssrLoadModule("/src/lib/task-review-store.ts?restart=1");
  await restarted.useTaskReviews.persist.rehydrate();
  const restored = restarted.useTaskReviews
    .getState()
    .requests.find((item: ReviewRequest) => item.id === request.id);
  assert.equal(reviewSummary(restored).reviewed, 2);
  assert.equal(restored.files[0].evidence[0].evidenceId, "read:a.ts:1");
  assert.equal(validateReviewRequest(restored), true);
});
