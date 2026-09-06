import assert from "node:assert/strict";
import { test } from "node:test";
import { captureRect } from "./canvas-capture.mjs";
test("capture is bounded to the requesting window, rejecting invalid/oversized rectangles", () => {
  assert.deepEqual(
    captureRect({ x: 10.5, y: 20.5, width: 1000, height: 1000 }, { width: 800, height: 600 }),
    { x: 10, y: 20, width: 790, height: 580 },
  );
  for (const rect of [
    { x: NaN, y: 0, width: 10, height: 10 },
    { x: 900, y: 0, width: 100, height: 100 },
    { x: 0, y: 0, width: -1, height: 50 },
  ])
    assert.throws(() => captureRect(rect, { width: 800, height: 600 }));
});
