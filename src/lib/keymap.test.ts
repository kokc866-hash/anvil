import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KEY_IN_FIELD } from "./keymap.ts";

describe("keymap field", () => {
  it("find/replace/goto steal from monaco textarea", () => {
    assert.ok(KEY_IN_FIELD.includes("find"));
    assert.ok(KEY_IN_FIELD.includes("replace"));
    assert.ok(KEY_IN_FIELD.includes("gotoLine"));
  });
});
