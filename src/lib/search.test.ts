import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { afterLine, applyHits, findInFiles } from "./search.ts";

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
});
