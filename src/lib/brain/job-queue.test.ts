import assert from "node:assert/strict";
import { test } from "node:test";
import { BrainJobQueue } from "./job-queue.ts";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((done) => { resolve = done; });
  return { promise, resolve };
}

test("a queued attachment times out even when the active GPU request never settles", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let busy = false;
  let interrupted = false;
  const queue = new BrainJobQueue((b) => { busy = b; }, () => assert.fail("timed out job logged as success"));
  const first = queue.enqueue(0, "shader", 20_000, (signal) => {
    signal.addEventListener("abort", () => { interrupted = true; });
    return new Promise<string>(() => {});
  });
  const firstError = assert.rejects(first, /Zeitlimit/);
  const attachment = queue.enqueue(1, "attach", 1600, async () => assert.fail("GPU jobs overlap"));
  const attachmentError = assert.rejects(attachment, /Zeitlimit: attach/);
  await flush();
  t.mock.timers.tick(1600);
  await attachmentError;
  assert.equal(busy, true);
  t.mock.timers.tick(18_400);
  await firstError;
  assert.equal(interrupted, true);
  assert.equal(busy, false);
  await assert.rejects(queue.enqueue(0, "intent", 800, async () => "agent"), /Zeitlimit/);
});

test("an active timeout rejects waiters and quarantines the engine without overlapping jobs", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let busy = false;
  const done: string[] = [];
  const queue = new BrainJobQueue((b) => { busy = b; }, (key) => done.push(key));
  const old = deferred();
  const firstError = assert.rejects(queue.enqueue(0, "old", 10, () => old.promise), /Zeitlimit/);
  const nextError = assert.rejects(queue.enqueue(1, "next", 100, async () => assert.fail("overlap")), /Zeitlimit/);
  await flush();
  t.mock.timers.tick(10);
  await Promise.all([firstError, nextError]);
  assert.equal(busy, false);
  await assert.rejects(queue.enqueue(0, "retry", 100, async () => assert.fail("quarantine bypassed")), /Zeitlimit/);

  // Disposing the old engine permits a new one. Its late completion must not
  // release the new engine's lock or write a success result into its history.
  queue.reset();
  const fresh = deferred();
  const second = queue.enqueue(0, "fresh", 100, () => fresh.promise);
  let thirdStarted = false;
  const third = queue.enqueue(1, "third", 100, async () => { thirdStarted = true; return "third"; });
  await flush();
  old.resolve("late");
  await flush();
  assert.equal(busy, true);
  assert.equal(thirdStarted, false);
  assert.deepEqual(done, []);
  fresh.resolve("fresh");
  assert.equal(await second, "fresh");
  assert.equal(await third, "third");
  await flush();
  assert.deepEqual(done, ["fresh", "third"]);
  assert.equal(busy, false);
});

test("normal jobs keep priority, FIFO order and supersede stale queued suggestions", async () => {
  const queue = new BrainJobQueue(() => {}, () => {});
  const first = deferred();
  const active = queue.enqueue(0, "active", 1000, () => first.promise);
  const order: string[] = [];
  const job = (name: string) => async () => { order.push(name); return name; };
  const low = queue.enqueue(2, "low", 1000, job("low"));
  const stale = assert.rejects(queue.enqueue(1, "attach", 1000, job("stale")), { name: "Superseded" });
  const attach = queue.enqueue(1, "attach", 1000, job("attach"));
  const high = queue.enqueue(0, "high", 1000, job("high"));
  const same = queue.enqueue(1, "same", 1000, job("same"));
  first.resolve("active");
  await Promise.all([active, low, stale, attach, high, same]);
  assert.deepEqual(order, ["high", "attach", "same", "low"]);
});

test("hold rejects new work; reset cancels active work; synchronous failures release the queue", async () => {
  const queue = new BrainJobQueue(() => {}, () => {});
  let signal: AbortSignal | undefined;
  const active = assert.rejects(queue.enqueue(0, "active", 1000, (s) => {
    signal = s;
    return new Promise<string>(() => {});
  }), /pausiert/);
  await flush();
  queue.setHold(true);
  await active;
  assert.equal(signal?.aborted, true);
  await assert.rejects(queue.enqueue(0, "held", 1000, async () => "wrong"), /pausiert/);
  queue.reset();
  queue.setHold(false);
  await assert.rejects(queue.enqueue(0, "throws", 1000, () => { throw new Error("sync"); }), /sync/);
  assert.equal(await queue.enqueue(1, "after", 1000, async () => "ok"), "ok");
});
