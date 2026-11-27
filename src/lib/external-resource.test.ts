import assert from "node:assert/strict";
import { test } from "node:test";
import { withForegroundResource, releaseForegroundResource } from "./external-resource.ts";

test("a dispatched operation retains its lease after an uncertain transport failure", async () => {
  const previous = globalThis.window;
  let held = 0;
  const calls: string[] = [];
  globalThis.window = { anvilNative: { agentJob: async (action: string) => {
    calls.push(action);
    if (action === "resource-acquire") { held++; return { leaseId: "uncertain-fixture", key: "external", owner: "renderer" }; }
    held--; return { ok: true };
  } } } as unknown as Window & typeof globalThis;
  try {
    const failure = new TypeError("synthetic lost reply");
    await assert.rejects(withForegroundResource(async () => { throw failure; }, undefined, () => "uncertain-fixture"), error => error === failure);
    assert.equal(held, 1, "an HTTP failure does not prove that the external operation ended");
    await releaseForegroundResource("uncertain-fixture");
    assert.equal(held, 0);
    assert.deepEqual(calls, ["resource-acquire", "resource-release"]);
  } finally {
    await releaseForegroundResource("uncertain-fixture");
    if (previous === undefined) Reflect.deleteProperty(globalThis, "window"); else globalThis.window = previous;
  }
});

test("a failed operation with no possible dispatch releases normally", async () => {
  const previous = globalThis.window;
  let held = 0;
  globalThis.window = { anvilNative: { agentJob: async (action: string) => {
    if (action === "resource-acquire") { held++; return { leaseId: "not-dispatched", key: "external", owner: "renderer" }; }
    held--; return { ok: true };
  } } } as unknown as Window & typeof globalThis;
  try {
    await assert.rejects(withForegroundResource(async () => { throw Error("not dispatched"); }, undefined, () => undefined), /not dispatched/);
    assert.equal(held, 0);
  } finally { if (previous === undefined) Reflect.deleteProperty(globalThis, "window"); else globalThis.window = previous; }
});
