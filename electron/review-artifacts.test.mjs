import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { ReviewArtifactStore } from "./review-artifacts.mjs";

const root = path.resolve("artifacts/cursor-adoption-2026-10-19/review/native-tests");
const sha = (value) => createHash("sha256").update(value).digest("hex");
async function fixture(t, limits) {
  await fs.mkdir(root, { recursive: true });
  const storageRoot = await fs.mkdtemp(path.join(root, "case-"));
  t.after(async () => {
    await fs.rm(storageRoot, { recursive: true, force: true });
  });
  return { store: new ReviewArtifactStore({ storageRoot, limits }), storageRoot };
}
function entry(overrides = {}) {
  return {
    project: "artificial-project",
    jobId: "job-1",
    jobVersion: "version-1",
    kind: "log",
    mime: "text/plain",
    observation: "diagnostic",
    result: "unknown",
    origin: { tool: "read_file", stepId: "step-251", evidenceId: "evidence-251" },
    fileStamps: { "src/main.ts": sha("current source") },
    data: "bounded diagnostic output",
    ...overrides,
  };
}

test("Selected evidence survives a fresh store with full provenance, outside job snapshots", async (t) => {
  const { store, storageRoot } = await fixture(t);
  const record = await store.save(entry());
  const reopened = new ReviewArtifactStore({ storageRoot });
  const result = await reopened.read({
    project: record.project,
    jobId: record.jobId,
    id: record.id,
    jobVersion: "version-1",
    fileStamps: record.fileStamps,
  });
  assert.equal(result.status, "ready");
  assert.equal(result.data.toString(), "bounded diagnostic output");
  assert.equal(result.artifact.origin.stepId, "step-251");
  assert.equal(result.artifact.sha256, sha("bounded diagnostic output"));
  assert.equal((await reopened.list({ project: record.project, jobId: record.jobId })).length, 1);
  assert.deepEqual((await fs.readdir(storageRoot)).sort(), ["review-artifacts"]);
});

test("Another project or job cannot resolve the same artifact ID", async (t) => {
  const { store } = await fixture(t);
  const record = await store.save(entry());
  assert.equal(
    (await store.read({ project: "different", jobId: record.jobId, id: record.id })).status,
    "missing",
  );
  assert.equal(
    (await store.read({ project: record.project, jobId: "different", id: record.id })).status,
    "missing",
  );
  assert.equal(
    (
      await store.read({
        project: record.project,
        jobId: record.jobId,
        id: record.id,
        jobVersion: "version-2",
      })
    ).status,
    "stale",
  );
  assert.equal(
    (
      await store.read({
        project: record.project,
        jobId: record.jobId,
        id: record.id,
        fileStamps: {},
      })
    ).status,
    "stale",
  );
});

test("Missing and changed artifact bytes stay explicit after restart", async (t) => {
  const { store, storageRoot } = await fixture(t);
  const record = await store.save(entry());
  const scope = { project: record.project, jobId: record.jobId, id: record.id };
  const target = path.join(storageRoot, "review-artifacts", `${record.id}.bin`);
  await fs.writeFile(target, "tampered");
  assert.equal((await store.read(scope)).status, "corrupt");
  await fs.unlink(target);
  assert.equal((await new ReviewArtifactStore({ storageRoot }).read(scope)).status, "missing");
});

test("File, total, count and manifest budgets preserve existing evidence", async (t) => {
  const { store } = await fixture(t, { fileBytes: 30, totalBytes: 40, files: 2 });
  await assert.rejects(store.save(entry({ data: "x".repeat(31) })), /Dateibudget/);
  await store.save(entry({ data: "x".repeat(20) }));
  await assert.rejects(store.save(entry({ data: "x".repeat(21) })), /voll/);
  await store.save(entry({ data: "x".repeat(20) }));
  await assert.rejects(store.save(entry({ data: "" })), /voll/);
  assert.equal((await store.list({ project: "artificial-project", jobId: "job-1" })).length, 2);
  const small = await fixture(t, { manifestBytes: 128 });
  await assert.rejects(small.store.save(entry()), /Manifest/);
  assert.deepEqual(await fs.readdir(path.join(small.storageRoot, "review-artifacts")), []);
});

test("Media cannot impersonate behavior evidence and paths and secrets remain bounded", async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(
    store.save(
      entry({
        kind: "screenshot",
        mime: "image/png",
        observation: "behavior-confirmed",
        result: "success",
      }),
    ),
    /ungültig/,
  );
  await assert.rejects(store.save(entry({ mime: "text/html" })), /ungültig/);
  await assert.rejects(store.save(entry({ fileStamps: { "../escape": sha("x") } })), /ungültig/);
  await assert.rejects(store.save(entry({ fileStamps: { ".env": sha("x") } })), /ungültig/);
  await assert.rejects(
    store.read({ project: "artificial-project", jobId: "job-1", id: "../escape" }),
    /Ungültige/,
  );
});

test("Concurrent appends are serialized and a linked artifact directory is rejected", async (t) => {
  const { store, storageRoot } = await fixture(t);
  await Promise.all(
    Array.from({ length: 8 }, (_, index) => store.save(entry({ data: String(index) }))),
  );
  assert.equal((await store.list({ project: "artificial-project", jobId: "job-1" })).length, 8);
  const linkedRoot = await fs.mkdtemp(path.join(root, "linked-"));
  t.after(async () => {
    await fs.rm(linkedRoot, { recursive: true, force: true });
  });
  try {
    await fs.symlink(
      path.join(storageRoot, "review-artifacts"),
      path.join(linkedRoot, "review-artifacts"),
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) {
      t.diagnostic("Symlink/Junction permissions unavailable; concurrent-append assertion passed.");
      return;
    }
    throw error;
  }
  await assert.rejects(
    new ReviewArtifactStore({ storageRoot: linkedRoot }).save(entry()),
    /sichere|Verknüpfte/,
  );
});
