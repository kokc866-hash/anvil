import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, rename, cp } from "node:fs/promises";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { downloadFile } from "./hf-get.mjs";
import { helperModelInfo, downloadHelperBundle, jsonFileOk, cancelHelperDownload, adoptLegacyHelper, deleteHelperBundle, recoverHelperBundles } from "./helper-files.mjs";

const reply = (body, etag = "v1", length = Buffer.byteLength(body)) => Object.assign(Readable.from([Buffer.from(body)]), { headers: { "content-length": String(length), etag } });
const source = "https://huggingface.co/mlc-ai/fixture/resolve/main/";
async function folder(t) {
  const dir = await mkdtemp(join(tmpdir(), "anvil-helper-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("same-length updates replace content; malformed or truncated downloads preserve the old file", async (t) => {
  const root = await folder(t), file = join(root, "config.json");
  await downloadFile(source + "config.json", file, jsonFileOk, { request: async () => reply('{"x":1}') });
  await downloadFile(source + "config.json", file, jsonFileOk, { force: true, request: async () => reply('{"x":2}', "v2") });
  assert.equal(await readFile(file, "utf8"), '{"x":2}');
  await assert.rejects(downloadFile(source + "config.json", file, jsonFileOk, { request: async () => reply('{"x":3', "bad") }), /JSON/);
  await assert.rejects(downloadFile(source + "config.json", file, jsonFileOk, { request: async () => reply('{"x":3}', "bad", 100) }), /unvollständig/);
  assert.equal(await readFile(file, "utf8"), '{"x":2}');
  assert.ok((await readdir(root)).every((name) => !name.includes(".part")));
});

const contents = {
  "mlc-chat-config.json": JSON.stringify({ tokenizer_files: ["tokenizer.json", "tokenizer_config.json"] }),
  "tensor-cache.json": JSON.stringify({ records: [{ dataPath: "params.bin", nbytes: 4 }] }),
  "tokenizer.json": "{}", "tokenizer_config.json": "{}", "params.bin": "1234", "model.wasm": Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
};
const files = Object.keys(contents).map((rel) => ({ rel, url: source + rel, lib: rel.endsWith(".wasm") }));
const downloader = (data = contents, etag = "v1") => (url, dest, json, options) => downloadFile(url, dest, json, { ...options, request: async () => reply(data[basename(dest)], etag) });

async function legacy(root, id = "fixture") {
  const dir = join(root, id), libs = join(root, "libs");
  await mkdir(dir); await mkdir(libs, { recursive: true });
  for (const [rel, data] of Object.entries(contents)) {
    await writeFile(join(rel.endsWith(".wasm") ? libs : dir, rel === "tensor-cache.json" ? "ndarray-cache.json" : rel), data);
  }
  return { dir, libs };
}
const artifact = (root, kind, id = "fixture") => join(root, `.${kind}-${id}-${randomUUID()}`);
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

test("one bundle per model; readiness needs every tokenizer, full shards and valid WASM", async (t) => {
  const root = await folder(t);
  let requests = 0, release;
  const gate = new Promise((r) => { release = r; });
  const get = async (...args) => { requests++; await gate; return downloader()(...args); };
  const first = downloadHelperBundle(root, { id: "fixture", files }, () => {}, get);
  const second = downloadHelperBundle(root, { id: "fixture", files }, () => {}, get);
  assert.equal(first, second);
  release(); await first;
  assert.equal(requests, files.length);
  assert.equal((await helperModelInfo(join(root, "fixture"))).ready, true);
  await rm(join(root, "fixture", "tokenizer_config.json"));
  assert.equal((await helperModelInfo(join(root, "fixture"))).ready, false);
  await downloadHelperBundle(root, { id: "fixture", files }, () => {}, downloader());
  await writeFile(join(root, "fixture", "params.bin"), "12");
  assert.equal((await helperModelInfo(join(root, "fixture"))).ready, false);
});

test("failed updates and cancelled installs never replace a complete model or leave a partial stage", async (t) => {
  const root = await folder(t);
  await downloadHelperBundle(root, { id: "fixture", files }, () => {}, downloader());
  const previous = await readFile(join(root, "fixture", "anvil-model.json"), "utf8");
  await assert.rejects(downloadHelperBundle(root, { id: "fixture", files, update: true }, () => {}, downloader({ ...contents, "params.bin": "123" }, "v2")), /unvollständig/);
  assert.equal(await readFile(join(root, "fixture", "params.bin"), "utf8"), "1234");
  assert.equal(await readFile(join(root, "fixture", "anvil-model.json"), "utf8"), previous);
  assert.equal((await helperModelInfo(join(root, "fixture"))).ready, true);
  const canceled = downloadHelperBundle(root, { id: "cancelled", files }, () => {}, (_u, _d, _j, { signal }) => new Promise((_r, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    void cancelHelperDownload(root, "cancelled");
  }));
  await assert.rejects(canceled, { name: "AbortError" });
  assert.deepEqual(await readdir(root), ["fixture"]);
});


test("complete legacy files are adopted without a network request or replacing the weights", async (t) => {
  const root = await folder(t), { dir, libs } = await legacy(root);
  assert.equal((await helperModelInfo(dir)).ready, false);
  assert.equal(await adoptLegacyHelper(dir, libs, "model.wasm"), true);
  assert.equal((await helperModelInfo(dir)).ready, true);
  assert.equal(await readFile(join(dir, "params.bin"), "utf8"), "1234");
  await writeFile(join(dir, "params.bin"), "bad");
  assert.equal(await adoptLegacyHelper(dir, libs, "model.wasm"), false, "damaged receipts cannot be disguised as legacy installs");
});

test("delete cancels active adoption and a queued update before removing the model", async (t) => {
  const root = await folder(t), { dir, libs } = await legacy(root);
  await mkdir(join(root, "unrelated"));
  await writeFile(join(root, "unrelated", "keep.txt"), "keep");
  const entered = deferred();
  let abortSeen = false, downloadStarted = false;
  const adoption = adoptLegacyHelper(dir, libs, "model.wasm", (_path, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => { abortSeen = true; reject(signal.reason); }, { once: true });
    entered.resolve();
  }));
  await entered.promise;
  const update = downloadHelperBundle(root, { id: "fixture", files, update: true }, () => {}, (...args) => {
    downloadStarted = true;
    return downloader()(...args);
  });
  const updateRejected = assert.rejects(update, { name: "AbortError" });
  const deleted = deleteHelperBundle(root, "fixture");
  assert.equal(await deleted, true);
  assert.equal(await adoption, false);
  await updateRejected;
  assert.equal(abortSeen, true, "file hashing receives cancellation");
  assert.equal(downloadStarted, false, "queued updates cannot recreate a removed model");
  assert.deepEqual((await readdir(root)).sort(), ["libs", "unrelated"]);
  assert.equal(await readFile(join(root, "unrelated", "keep.txt"), "utf8"), "keep");
});

test("cancel stops adoption without deleting legacy weights; a later load may adopt again", async (t) => {
  const root = await folder(t), { dir, libs } = await legacy(root);
  const entered = deferred();
  const adoption = adoptLegacyHelper(dir, libs, "model.wasm", (_path, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    entered.resolve();
  }));
  await entered.promise;
  await cancelHelperDownload(root, "fixture");
  assert.equal(await adoption, false);
  assert.equal(await readFile(join(dir, "params.bin"), "utf8"), "1234");
  await assert.rejects(readFile(join(dir, "anvil-model.json")), { code: "ENOENT" });
  assert.equal(await adoptLegacyHelper(dir, libs, "model.wasm"), true);
});

test("a fresh download waits for cancelled work and an earlier delete, then installs normally", async (t) => {
  const root = await folder(t), entered = deferred(), release = deferred();
  let abortSeen = false, newStarted = false;
  const first = downloadHelperBundle(root, { id: "fixture", files }, () => {}, async (_url, _dest, _json, { signal }) => {
    signal.addEventListener("abort", () => { abortSeen = true; }, { once: true });
    entered.resolve();
    await release.promise;
    signal.throwIfAborted();
  });
  const firstRejected = assert.rejects(first, { name: "AbortError" });
  await entered.promise;
  const deletion = deleteHelperBundle(root, "fixture");
  const next = downloadHelperBundle(root, { id: "fixture", files }, () => {}, (...args) => {
    newStarted = true;
    return downloader()(...args);
  });
  assert.equal(abortSeen, true);
  assert.equal(newStarted, false, "new files wait until prior handles are closed");
  release.resolve();
  await firstRejected; await deletion; await next;
  assert.equal(newStarted, true);
  assert.equal((await helperModelInfo(join(root, "fixture"))).ready, true);
  assert.deepEqual(await readdir(root), ["fixture"]);
});

test("startup restores the previous complete model after a crash in the directory swap", async (t) => {
  const root = await folder(t), dir = join(root, "fixture");
  await downloadHelperBundle(root, { id: "fixture", files }, () => {}, downloader());
  const oldReceipt = await readFile(join(dir, "anvil-model.json"), "utf8");
  const backup = artifact(root, "previous"), stage = artifact(root, "download");
  await cp(dir, stage, { recursive: true });
  await writeFile(join(stage, "params.bin"), "cut");
  await rename(dir, backup);
  const result = await recoverHelperBundles(root);
  assert.deepEqual(result, { restored: ["fixture"], issues: [] });
  assert.equal(await readFile(join(dir, "anvil-model.json"), "utf8"), oldReceipt);
  assert.equal((await helperModelInfo(dir)).ready, true);
  assert.deepEqual(await readdir(root), ["fixture"]);
  assert.deepEqual(await recoverHelperBundles(root), { restored: [], issues: [] }, "recovery is idempotent");
});

test("startup retains the published update and removes only owned recovery copies", async (t) => {
  const root = await folder(t), dir = join(root, "fixture");
  await downloadHelperBundle(root, { id: "fixture", files }, () => {}, downloader());
  await cp(dir, artifact(root, "previous"), { recursive: true });
  await downloadHelperBundle(root, { id: "fixture", files }, () => {}, downloader({ ...contents, "params.bin": "5678" }, "v2"));
  const foreign = ".download-fixture-manual-backup";
  await mkdir(join(root, foreign));
  await writeFile(join(root, foreign, "keep.txt"), "keep");
  await mkdir(artifact(root, "download"));
  assert.deepEqual(await recoverHelperBundles(root), { restored: [], issues: [] });
  assert.equal(await readFile(join(dir, "params.bin"), "utf8"), "5678");
  assert.deepEqual((await readdir(root)).sort(), [foreign, "fixture"].sort());
  assert.equal(await readFile(join(root, foreign, "keep.txt"), "utf8"), "keep");
});

test("startup can finish a complete first install but never publishes an incomplete download", async (t) => {
  const root = await folder(t), id = "model-with-hyphens-q4f16_1";
  await downloadHelperBundle(root, { id, files }, () => {}, downloader());
  await rename(join(root, id), artifact(root, "download", id));
  await mkdir(artifact(root, "download", "incomplete"));
  assert.deepEqual(await recoverHelperBundles(root), { restored: [id], issues: [] });
  assert.equal((await helperModelInfo(join(root, id))).ready, true);
  assert.deepEqual(await readdir(root), [id]);
});

test("recovery preserves legacy originals and uncertain backups; delete removes their recovery copies", async (t) => {
  const root = await folder(t), { dir, libs } = await legacy(root);
  await rename(dir, artifact(root, "previous"));
  assert.deepEqual(await recoverHelperBundles(root), { restored: ["fixture"], issues: [] });
  assert.equal(await readFile(join(dir, "params.bin"), "utf8"), "1234");
  const backup = artifact(root, "previous");
  await cp(dir, backup, { recursive: true });
  assert.deepEqual(await recoverHelperBundles(root), { restored: [], issues: [] });
  assert.equal(await readFile(join(backup, "params.bin"), "utf8"), "1234", "unverified visible installations do not discard backups");
  assert.equal(await adoptLegacyHelper(dir, libs, "model.wasm"), true);
  await cp(dir, artifact(root, "download"), { recursive: true });
  await deleteHelperBundle(root, "fixture");
  assert.deepEqual(await recoverHelperBundles(root), { restored: [], issues: [] });
  assert.deepEqual(await readdir(root), ["libs"], "an intentional delete never resurrects on restart");
});
