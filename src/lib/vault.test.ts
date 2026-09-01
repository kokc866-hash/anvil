import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { envNames, redactPatterns } from "./vault-redact.ts";

describe("vault", () => {
  it("redacts tokens and assignment", () => {
    const r = redactPatterns("key sk-abcdefghijklmnopqrstuv token=x Bearer abcdefghijkl");
    assert.match(r.text, /\[redacted\]/);
    assert.ok(r.n >= 1);
  });
  it("lists env keys without values", () => {
    assert.deepEqual(envNames("FOO=bar\n# x\nBAZ=1\n"), ["FOO", "BAZ"]);
  });
});
