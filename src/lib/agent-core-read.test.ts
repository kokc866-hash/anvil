import assert from "node:assert/strict";
import { test } from "node:test";
import { packToolContent, readKey, readWindow, READ_CHAR_CAP } from "./agent-read.ts";

test("small file reads in full", () => {
  const src = "a\nb\nc";
  const w = readWindow(src);
  assert.equal(w.truncated, false);
  assert.equal(w.body, src);
  assert.equal(w.total, 3);
});

test("large file windows with start_line", () => {
  const src = Array.from({ length: 8000 }, (_, i) => `L${i + 1} ${"x".repeat(40)}`).join("\n");
  assert.ok(src.length > READ_CHAR_CAP);
  const w = readWindow(src, 1, 0);
  assert.equal(w.truncated, true);
  assert.equal(w.from, 1);
  assert.ok(w.to < 8000);
  const w2 = readWindow(src, w.to + 1, 0);
  assert.equal(w2.from, w.to + 1);
});

test("pack tells the model to continue, not rewrite", () => {
  const packed = packToolContent("read_file", {
    path: "index.html",
    content: "hello",
    start_line: 1,
    end_line: 1,
    total_lines: 900,
    truncated: true,
  });
  assert.match(packed, /start_line=2/);
  assert.doesNotMatch(packed, /abgeschnitten/);
  assert.match(packed, /    1\|hello/);
});

test("small pack has no truncate note", () => {
  const packed = packToolContent("read_file", {
    path: "a.js",
    content: "x",
    start_line: 1,
    end_line: 1,
    total_lines: 1,
    truncated: false,
  });
  assert.doesNotMatch(packed, /abgeschnitten/);
  assert.ok(packed.length < READ_CHAR_CAP);
});

test("read windows of the same file are different keys", () => {
  assert.notEqual(readKey("big.ts", 1), readKey("big.ts", 2501));
  assert.equal(readKey("big.ts", 1), readKey("big.ts"));
});

test("run_file pack is the Compile/Run log", () => {
  const packed = packToolContent("run_file", {
    ok: false,
    stdout: "— Compile —\nc++ main.cpp -o out",
    stderr: "main.cpp:1: error: x",
    hint: "Error. Patch and run_file again.",
  });
  assert.match(packed, /RUN FAIL/);
  assert.match(packed, /Compile/);
  assert.match(packed, /main\.cpp:1/);
  assert.doesNotMatch(packed, /^\{/);
});
