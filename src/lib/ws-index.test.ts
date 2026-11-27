import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lookupSymbol, parseFile, rebuildIndex, resolveImport, searchIndex, summarizeFile, workspaceIndex, workspaceMap, workspaceTree } from "./ws-index.ts";

describe("ws-index", () => {
  it("counts declaration lines once without changing blank-line or CRLF locations", () => {
    const row = parseFile("symbols.ts", "\r\nconst first = 1;\r\n\r\nexport function ping() {}\r\nclass Box {}\r\n");
    assert.deepEqual(row.symbols.map(({ name, line, text }) => ({ name, line, text })), [
      { name: "first", line: 2, text: "const first = 1;" },
      { name: "ping", line: 4, text: "export function ping() {}" },
      { name: "Box", line: 5, text: "class Box {}" },
    ]);
  });
  it("picks names and comment", () => {
    const s = summarizeFile(
      "src/app.ts",
      "// Counter widget\nexport function add(a: number) { return a; }\nclass Box {}\n",
    );
    assert.match(s, /Counter/);
    assert.match(s, /add/);
    assert.match(s, /Box/);
  });
  it("skips secrets and vendor", () => {
    const idx = workspaceIndex({
      "b.py": "def run():\n  pass\n",
      ".env": "KEY=1",
      "a.ts": "export const n = 1;\n",
      "node_modules/foo/index.js": "export const x = 1;\n",
    });
    assert.match(idx, /^a\.ts/m);
    assert.equal(idx.includes(".env"), false);
    assert.equal(idx.includes("node_modules"), false);
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
  it("keeps the row across a no-op rebuild", () => {
    const files = { "a.ts": "export const n = 1;\n" };
    const a = rebuildIndex(files);
    const b = rebuildIndex(files);
    assert.equal(a[0], b[0]);
  });
  it("summarizes a large tree", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 220; i++) files[`src/f${i}.ts`] = `export const n${i} = ${i};\n`;
    const tree = workspaceTree(files, ["src/f9.ts"], 20);
    assert.match(tree, /src\/f9\.ts/);
    assert.match(tree, /weitere/);
  });
  it("maps a medium tree by folder", () => {
    const files: Record<string, string> = {
      "package.json": "{}",
      "README.md": "# app",
    };
    for (let i = 0; i < 80; i++) files[`src/f${i}.ts`] = `export const n${i} = ${i};\n`;
    for (let i = 0; i < 20; i++) files[`lib/u${i}.ts`] = `export function u${i}() {}\n`;
    const map = workspaceMap(files, ["src/f9.ts"]);
    assert.match(map, /Dateien/);
    assert.match(map, /src\//);
    assert.match(map, /lib\//);
    assert.match(map, /package\.json/);
    assert.match(map, /src\/f9\.ts/);
    assert.match(map, /list_files/);
  });
});
