import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { afterLine, applyHits, findInFiles, replaceInFiles, searchableFiles } from "./search.ts";

const files = {
  "a.ts": "foo bar\nFoo baz\nkeep foo foo\n",
  ".env": "foo=secret\n",
  "b.ts": "count 12 and 34\n",
};

describe("search", () => {
  it("finds case-insensitive and skips secrets", () => {
    const hits = findInFiles(files, "foo");
    assert.equal(hits.some((h) => h.path === ".env"), false);
    assert.ok(hits.length >= 3);
  });
  it("word does not match foobar", () => {
    const hits = findInFiles({ "a.ts": "foo foobar foo\n" }, "foo", { word: true });
    assert.equal(hits.length, 2);
  });
  it("previews regex replace with $1", () => {
    const hits = findInFiles({ "a.ts": "n_12 done\n" }, "n_(\\d+)", { regex: true });
    assert.equal(hits[0]?.match, "n_12");
    assert.equal(afterLine(hits[0]!, "n_(\\d+)", "id$1", { regex: true }).includes("id12"), true);
  });
  it("applies only picked occurrences on a line", () => {
    const hits = findInFiles({ "a.ts": "foo foo\n" }, "foo");
    const one = applyHits({ "a.ts": "foo foo\n" }, [hits[0]!], "foo", "bar", {});
    assert.equal(one["a.ts"], "bar foo\n");
  });
  it("keeps binary, oversized, secret and vendor files out of search and replacements", () => {
    const excluded = { ".env": "foo", "node_modules/a.js": "foo", "a.png": "foo", "raw.txt": "foo\0",
      "encoded.txt": "DATA:application/octet-stream;base64,Zm9v", "large.ts": "foo" + "x".repeat(1_500_000) };
    const sources = { ...excluded, "a.ts": "foo\r\nfoo\n" };
    assert.deepEqual(searchableFiles(sources), { "a.ts": sources["a.ts"] });
    const hits = findInFiles(sources, "foo");
    assert.deepEqual(hits.map((h) => [h.path, h.line, h.col]), [["a.ts", 1, 1], ["a.ts", 2, 1]]);
    assert.deepEqual(replaceInFiles(sources, "foo", "bar"), { patched: { "a.ts": "bar\r\nbar\n" }, total: 2 });
    assert.deepEqual(applyHits(sources, [{ path: ".env", line: 1, col: 1, end: 4, text: "foo", match: "foo" }], "foo", "bar", {}), {});
  });
});
