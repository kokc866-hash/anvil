import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fingerprint, internNoise, internPromptFrom, suggestHeal } from "./intern-core.ts";

describe("intern", () => {
  it("fingerprints numbers and urls", () => {
    const a = fingerprint("js", "boom at https://x.test/a.js:12:3 count 4");
    const b = fingerprint("js", "boom at https://y.test/b.js:99:1 count 9");
    assert.equal(a, b);
  });
  it("suggests board reset", () => {
    const s = suggestHeal(fingerprint("board", "board.json unlesbar"), "board");
    assert.equal(s.heal, "board-reset");
    assert.equal(s.auto, true);
  });
  it("suggests agent abort", () => {
    const s = suggestHeal(fingerprint("agent", "Maximale Tool-Runden erreicht"), "agent");
    assert.equal(s.heal, "agent-task");
  });
  it("stalls do not auto-abort", () => {
    const s = suggestHeal(fingerprint("agent", "Agent hängt ohne Fortschritt"), "agent");
    assert.equal(s.heal, "agent-task");
    assert.equal(s.auto, false);
  });
  it("persist is not auto", () => {
    const s = suggestHeal(fingerprint("persist", "QuotaExceededError idb"), "persist");
    assert.equal(s.heal, "soft-restart");
    assert.equal(s.auto, false);
  });
  it("ignores abort timeout noise", () => {
    assert.equal(internNoise("timeout"), true);
    assert.equal(internNoise("js timeout"), true);
    assert.equal(internNoise("AbortError"), true);
    assert.equal(internNoise("signal timed out"), true);
    assert.equal(internNoise("Failed to parse URL from /monaco/vs/language/html/htmlWorker.js"), true);
  });
  it("intern prompt lists open faults only", () => {
    const text = internPromptFrom([
      { open: true, kind: "board", msg: "json kaputt" },
      { open: false, kind: "js", msg: "alt" },
    ]);
    assert.match(text, /board/);
    assert.doesNotMatch(text, /alt/);
  });
});
