import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { modelsToDrop } from "./monaco-models.ts";

describe("monaco prune", () => {
  it("keeps open tabs", () => {
    const drop = modelsToDrop(["/a.ts", "/b.ts", "/c.ts"], ["b.ts"]);
    assert.deepEqual(drop.sort(), ["a.ts", "c.ts"]);
  });
  it("ignores empty keep", () => {
    assert.deepEqual(modelsToDrop(["/a.ts"], []), ["a.ts"]);
  });
});
