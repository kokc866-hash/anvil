import assert from "node:assert/strict";
import { test } from "node:test";
import { planMove } from "./move-plan.ts";
import { findInFiles, applyHits, replacementText, replaceInFiles } from "./search.ts";
import { ensureTs, tscWorkspace, tsRename } from "./lsp-compile.ts";

test("moving a directory preserves its root and refuses collisions", () => {
  const files = { "src/a.c": "A", "dest/a.c": "B" };
  assert.deepEqual(planMove(files, ["src", "src/empty", "dest"], "src", "dest/src").mapping, { "src/a.c": "dest/src/a.c" });
  assert.ok(planMove(files, ["src", "src/empty", "dest"], "src", "dest/src").movedDirs.includes("dest/src/empty"));
  assert.throws(() => planMove(files, ["src", "dest"], "src", "dest"), /existiert/);
  assert.throws(() => planMove(files, ["src"], "src", "src/nested"), /Ungültig/);
  assert.throws(() => planMove(files, ["src", "DEST"], "src", "dest"), /existiert/);
});

test("same-size edit at a formerly unsampled character invalidates TS diagnostics", async () => {
  const before = " const x: number = 1;\n" + "// padding\n".repeat(1500);
  const valid = await ensureTs({ "a.ts": before });
  const after = before.slice(0, 19) + "x" + before.slice(20);
  const hits = await tscWorkspace({ "a.ts": after });
  const next = await ensureTs({ "renamed.ts": after });
  assert.equal(valid?.ls, next?.ls, "service is reused incrementally");
  assert.deepEqual(next?.roots, ["renamed.ts"]);
  assert.ok(hits.length > 0);
});

test("semantic rename preserves strings and unrelated scopes/files", async () => {
  const text = 'export const count = 1; const s = "count"; function f(count: number) { return count; } console.log(count);';
  const result = await tsRename({ "a.ts": text, "b.ts": "export const count = 2;" }, "a.ts", 14, "total");
  assert.equal(result["b.ts"], undefined);
  assert.match(result["a.ts"], /"count"; function f\(count: number\) \{ return count; \}/);
  assert.match(result["a.ts"], /console.log\(total\)/);
});

test("replace all is independent of the display cap and preserves lookaround captures", () => {
  const files = { "a.txt": "foo\n".repeat(250) };
  const hits = findInFiles(files, "foo", {}, Infinity);
  assert.equal(hits.length, 250);
  assert.equal(applyHits(files, hits, "foo", "bar", {})["a.txt"], "bar\n".repeat(250));
  const contextual = { "b.txt": "ab ab" }, opts = { regex: true };
  assert.equal(applyHits(contextual, findInFiles(contextual, "(?<=a)(b)", opts), "(?<=a)(b)", "$1$1", opts)["b.txt"], "abb abb");
  const m = /(a)(b)/g.exec("zabq")!;
  assert.equal(replacementText("$$:$&:$1:$2:$`:$'", m, "zabq"), "$:ab:a:b:z:q");
});

test("bulk replacement counts all matches without display hit allocation", () => {
  const result = replaceInFiles({ "a.txt": "ab ".repeat(100_000) }, "(?<=a)(b)", "$1$1", { regex: true });
  assert.equal(result.total, 100_000);
  assert.equal(result.patched["a.txt"], "abb ".repeat(100_000));
});
