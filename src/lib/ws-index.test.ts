import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lookupSymbol, rebuildIndex, resolveImport, searchIndex, summarizeFile, workspaceIndex } from "./ws-index.ts";

describe("ws-index", () => {
  it("picks names and comment", () => {
    const s = summarizeFile(
      "src/app.ts",
      "// Counter widget\nexport function add(a: number) { return a; }\nclass Box {}\n",
    );
    assert.match(s, /Counter/);
    assert.match(s, /add/);
    assert.match(s, /Box/);
  });
  it("skips secrets and sorts", () => {
    const idx = workspaceIndex({
      "b.py": "def run():\n  pass\n",
      ".env": "KEY=1",
      "a.ts": "export const n = 1;\n",
    });
    assert.match(idx, /^a\.ts/m);
    assert.equal(idx.includes(".env"), false);
    assert.match(idx, /b\.py/);
  });
  it("finds symbols and relative imports", () => {
    const files = {
      "src/util.ts": "export function add(a: number) { return a + 1; }\n",
      "src/main.ts": "import { add } from './util';\nadd(1);\n",
    };
    rebuildIndex(files);
    const hits = lookupSymbol("add", "src/main.ts");
    assert.equal(hits[0]?.path, "src/util.ts");
    assert.equal(resolveImport("src/main.ts", "./util", files), "src/util.ts");
    const q = searchIndex("add", files);
    assert.ok(q.some((h) => h.kind === "symbol" && h.path === "src/util.ts"));
  });
});
