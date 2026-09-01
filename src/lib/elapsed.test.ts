import assert from "node:assert/strict";
import { test } from "node:test";
import { formatElapsed } from "./elapsed.ts";

test("formatElapsed", () => {
  assert.equal(formatElapsed(0), "0s");
  assert.equal(formatElapsed(12_000), "12s");
  assert.equal(formatElapsed(67_000), "1:07");
  assert.equal(formatElapsed(3_661_000), "1:01:01");
});
