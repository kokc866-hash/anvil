import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const options = {
  context: 131072,
  compact: "off",
  runLoop: false,
  graphLoop: false,
  testLoop: false,
  autoRunAgent: false,
  maxRounds: 16,
};
const tool = (name, args) => ({
  content: "",
  tool_calls: [
    {
      id: `review-${crypto.randomUUID()}`,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    },
  ],
});
async function fixture(t) {
  const root = path.resolve("artifacts/cursor-adoption-2026-10-19/review/loop-tests");
  await fs.mkdir(root, { recursive: true });
  const cacheDir = await fs.mkdtemp(path.join(root, "vite-"));
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    cacheDir,
    resolve: { alias: { "@": path.resolve("src") } },
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
  });
  t.after(async () => {
    await server.close();
    if (cacheDir.startsWith(root + path.sep))
      await fs.rm(cacheDir, { recursive: true, force: true });
  });
  return {
    server,
    ...(await server.ssrLoadModule("/src/lib/agent-core.ts")),
    ...(await server.ssrLoadModule("/src/lib/agent-abort.ts")),
    ...(await server.ssrLoadModule("/src/lib/task-review.ts")),
  };
}
function input(f, request, files, extra = {}) {
  return {
    ...options,
    review: request,
    files: Object.entries(files).map(([path, content]) => ({ path, content })),
    messages: [{ role: "user", content: f.buildReviewPrompt(request) }],
    ...extra,
  };
}

test("Connected partial review counts only actual complete reads, keeps remaining files open and emits bound metadata", async (t) => {
  const f = await fixture(t);
  f.beginAgent();
  const before = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`file-${i}.ts`, "old"]));
  const files = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`file-${i}.ts`, "first\nchanged\nlast"]),
  );
  const review = await f.createReviewRequest({
    project: "synthetic-project",
    baselineFiles: before,
    files,
  });
  let rounds = 0,
    writes = 0;
  const reports = [];
  const result = await f.runAgentLoop(
    input(f, review, files),
    async (messages) => {
      switch (++rounds) {
        case 1:
          return tool("read_file", { path: "file-0.ts", start_line: 1, end_line: 1 });
        case 2:
          return tool("read_file", { path: "file-0.ts", start_line: 2, end_line: 3 });
        case 3:
          return tool("read_file", { path: "file-1.ts", start_line: 1, end_line: 1 });
        case 4:
          return tool("review_submit", {
            reviewId: review.id,
            files: [
              {
                path: "file-0.ts",
                status: "reviewed",
                findings: [
                  {
                    line: 2,
                    title: "Synthetic finding",
                    detail: "A test fixture observation, not a real model verdict.",
                  },
                ],
              },
              { path: "file-1.ts", status: "reviewed" },
              { path: "file-2.ts", status: "skipped", reason: "Not examined" },
            ],
          });
        default:
          assert.match(String(messages.at(-1).content), /"reviewed":1/);
          return {
            content:
              "One file reviewed; eight remain open and one was skipped. Functional behavior was not tested.",
          };
      }
    },
    {
      onReviewReport: (report) => {
        reports.push(report);
      },
      onWorkspace: () => {
        writes++;
      },
    },
  );
  assert.equal(reports.length, 1);
  assert.equal(writes, 0);
  assert.equal(result.review.id, review.id);
  assert.equal(result.review.project, "synthetic-project");
  assert.deepEqual(f.reviewSummary(result.review), {
    total: 10,
    reviewed: 1,
    skipped: 1,
    open: 8,
    stale: 0,
    findings: 1,
    status: "limited",
  });
  assert.equal(result.review.files[0].evidence.length, 2);
  assert.ok(
    result.review.files[0].evidence.every((read) => read.evidenceId.startsWith(review.id + ":")),
  );
  assert.equal(
    result.verification.state,
    "none",
    "Review metadata must never become execution or functional verification",
  );
});

test("Deleted file review uses explicit native baseline reads and never claims to have read a current file", async (t) => {
  const f = await fixture(t);
  f.beginAgent();
  const review = await f.createReviewRequest({
    project: "deleted-fixture",
    baselineFiles: { "removed.ts": "before\nsecond" },
    files: {},
  });
  let rounds = 0;
  const result = await f.runAgentLoop(input(f, review, {}), async () => {
    if (++rounds === 1) return tool("review_read_baseline", { path: "removed.ts" });
    if (rounds === 2)
      return tool("review_submit", {
        reviewId: review.id,
        files: [{ path: "removed.ts", status: "reviewed" }],
      });
    return { content: "The removed source was read from its captured comparison baseline." };
  });
  assert.equal(result.review.files[0].status, "reviewed");
  assert.equal(result.review.files[0].evidence[0].source, "baseline");
  assert.match(result.review.files[0].reason, /keine aktuelle Datei/);
});

test("Fabricated evidence, an image stub and pack-time truncation never certify complete current reads", async (t) => {
  const f = await fixture(t);
  for (const [label, content, actualRead] of [
    ["fabricated", "first\nlast", false],
    ["image-stub", "data:image/png;base64,AAAA", true],
    ["long-line", "x".repeat(260000), true],
  ]) {
    f.beginAgent();
    const files = { "file.ts": content };
    const review = await f.createReviewRequest({
      project: label,
      baselineFiles: { "file.ts": "before" },
      files,
    });
    let rounds = 0;
    const result = await f.runAgentLoop(input(f, review, files), async () => {
      rounds++;
      if (actualRead && rounds === 1) return tool("read_file", { path: "file.ts" });
      if (rounds === (actualRead ? 2 : 1))
        return tool("review_submit", {
          reviewId: review.id,
          files: [{ path: "file.ts", status: "reviewed" }],
          reads: [
            {
              path: "file.ts",
              stamp: review.files[0].current.stamp,
              from: 1,
              to: review.files[0].current.lines,
              total: review.files[0].current.lines,
              evidenceId: "forged",
            },
          ],
        });
      return { content: "Coverage remains open without complete native source reads." };
    });
    assert.equal(result.review.files[0].status, "open", label);
    assert.equal(result.review.files[0].evidence.length, 0, label);
  }
});

test("Review tools require a bound request and exact marker and stay explicitly read-only", async (t) => {
  const f = await fixture(t);
  assert.equal(
    f
      .pickAgentTools({ observeOnly: true })
      .some((item) => item.function.name.startsWith("review_")),
    false,
  );
  assert.deepEqual(
    f
      .pickAgentTools({ observeOnly: true, review: true })
      .filter((item) => item.function.name.startsWith("review_"))
      .map((item) => item.function.name)
      .sort(),
    ["review_read_baseline", "review_submit"],
  );
  f.beginAgent();
  let rounds = 0,
    callbacks = 0;
  await f.runAgentLoop(
    {
      ...options,
      files: [],
      messages: [{ role: "user", content: "Review this unknown context. Read only." }],
    },
    async (messages) => {
      if (++rounds === 1) return tool("review_submit", { reviewId: "unknown", files: [] });
      assert.match(String(messages.at(-1).content), /Kein bekannter Review/);
      return { content: "No connected review exists." };
    },
    {
      onReviewReport: () => {
        callbacks++;
      },
    },
  );
  assert.equal(callbacks, 0);
  const review = await f.createReviewRequest({
    project: "read-only",
    baselineFiles: { "a.ts": "a" },
    files: { "a.ts": "b" },
  });
  f.beginAgent();
  let models = 0;
  await assert.rejects(
    f.runAgentLoop(
      input(
        f,
        review,
        { "a.ts": "b" },
        { messages: [{ role: "user", content: "Unrelated user prompt" }] },
      ),
      async () => {
        models++;
        return { content: "No model invocation should occur." };
      },
    ),
    /Review-Auftrag/,
  );
  assert.equal(models, 0);
  f.beginAgent();
  rounds = 0;
  let writes = 0,
    runs = 0;
  const result = await f.runAgentLoop(
    input(f, review, { "a.ts": "b" }),
    async () => {
      if (++rounds === 1)
        return tool("write_file", { path: "other.ts", content: "not authorized" });
      if (rounds === 2) return tool("run_file", { path: "a.ts" });
      return { content: "No source writes or execution were performed." };
    },
    {
      onWorkspace: () => {
        writes++;
      },
      runFile: () => {
        runs++;
        return { ok: true };
      },
    },
  );
  assert.equal(writes, 0);
  assert.equal(runs, 0);
  assert.equal(
    result.files.some((file) => file.path === "other.ts"),
    false,
  );
});

test("Failed report persistence and a wrong review ID never publish successful coverage", async (t) => {
  const f = await fixture(t);
  f.beginAgent();
  const review = await f.createReviewRequest({
    project: "persist-failure",
    baselineFiles: { "a.ts": "a" },
    files: { "a.ts": "b" },
  });
  let rounds = 0,
    calls = 0;
  const result = await f.runAgentLoop(
    input(f, review, { "a.ts": "b" }),
    async (messages) => {
      if (++rounds === 1) return tool("read_file", { path: "a.ts" });
      if (rounds === 2)
        return tool("review_submit", {
          reviewId: "foreign-id",
          files: [{ path: "a.ts", status: "reviewed" }],
        });
      if (rounds === 3) {
        assert.match(String(messages.at(-1).content), /Review-ID/);
        return tool("review_submit", {
          reviewId: review.id,
          files: [{ path: "a.ts", status: "reviewed" }],
        });
      }
      assert.match(String(messages.at(-1).content), /Simulated storage failure/);
      return { content: "Report could not be saved; coverage remains open." };
    },
    {
      onReviewReport: () => {
        calls++;
        throw Error("Simulated storage failure");
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.review.files[0].status, "open");
});
