import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ensureTs, tscWorkspace, tsChecked, tsDefinition, tsQuickInfo } from "./lsp-compile.ts";
import { hasTsSource, tsRoots } from "./compiler-files.ts";

describe("lsp-compile", () => {
  it("shares supported roots and open-file size limits with the lazy guard", () => {
    const files = { "a.js": "export const n = 1;", "a.mts": "export const m = 2;", "main.py": "pass",
      "node_modules/a.ts": "const n = 1;", "anvil-lib/a.ts": "const n = 1;", "large.ts": "x".repeat(200_000), "empty.ts": "" };
    assert.deepEqual(tsRoots(files), ["a.js", "a.mts"]);
    assert.deepEqual(tsRoots(files, ["large.ts", "a.js"]), ["large.ts", "a.js", "a.mts"]);
    assert.equal(hasTsSource({ "large.ts": files["large.ts"] }), false);
    assert.equal(hasTsSource({ "large.ts": files["large.ts"] }, ["large.ts"]), true);
  });
  it("flags a typescript syntax error", async () => {
    const hits = await tscWorkspace({
      "src/a.ts": "export function hi(\n",
    });
    assert.ok(hits.length >= 1);
    assert.equal(hits[0]?.source, "tsc");
    assert.equal(hits[0]?.path, "src/a.ts");
  });
  it("flags a type error", async () => {
    const hits = await tscWorkspace({
      "src/bad.ts": 'export const n: number = "x";\n',
    });
    assert.ok(hits.some((h) => /number|string|Type/i.test(h.message)));
    assert.equal(hits[0]?.source, "tsc");
  });
  it("accepts valid ts", async () => {
    const hits = await tscWorkspace({ "src/ok.ts": "export const n: number = 1;\n" });
    assert.equal(hits.length, 0);
  });
  it("hover shows tsc type", async () => {
    const src = "export const n: number = 1;\n";
    const files = { "src/ok.ts": src };
    await ensureTs(files);
    const md = await tsQuickInfo(files, "src/ok.ts", src.indexOf("n:"));
    assert.ok(md && /tsc|number/i.test(md));
  });
  it("rechecks after a same-length type edit", async () => {
    const a = 'export const n: string = "xx";\n';
    const b = 'export const n: number = "xx";\n';
    assert.equal(a.length, b.length);
    const ok = await tscWorkspace({ "src/x.ts": a });
    assert.equal(ok.length, 0);
    const bad = await tscWorkspace({ "src/x.ts": b });
    assert.ok(bad.some((h) => /number|string|Type/i.test(h.message)));
  });
  it("definition lands on the declaration", async () => {
    const src = "export function ping() { return 1; }\nping();\n";
    const files = { "src/a.ts": src };
    await ensureTs(files);
    const defs = await tsDefinition(files, "src/a.ts", src.lastIndexOf("ping"));
    assert.ok(defs.length >= 1);
    assert.equal(defs[0]?.path, "src/a.ts");
    assert.equal(defs[0]?.line, 1);
  });
  it("typechecks an open file over 200k", async () => {
    const pad = "const x = 1;\n".repeat(16_000);
    const src = `${pad}export const n: number = "x";\n`;
    assert.ok(src.length > 200_000);
    const hits = await tscWorkspace({ "src/big.ts": src }, ["src/big.ts"]);
    assert.ok(hits.some((h) => h.path === "src/big.ts"));
    const closed = await tscWorkspace({ "src/big.ts": src }, []);
    assert.equal(closed.length, 0);
    assert.deepEqual(tsChecked(), [], "an empty compiler scope releases previous language services");
  });
});

// Reported desktop regression: DOM and standard arrays disappeared in the packaged worker.
it("loads actual DOM and ECMAScript libraries and honors nested tsconfig", async () => {
  const files = {
    "tsconfig.json": '{"compilerOptions":{"lib":["ES2022"]},"include":["root.ts"]}',
    "root.ts": "export const root: number = 1;",
    "snake/tsconfig.json": '{"compilerOptions":{"lib":["ES2017","DOM"]},"include":["./snake.ts"]}',
    "snake/snake.ts": 'export const canvas = document.createElement("canvas") as HTMLCanvasElement; const ctx: CanvasRenderingContext2D = canvas.getContext("2d")!; const data: Record<string, HTMLImageElement> = {}; const a: [number, number][] = [[1,2]]; a.some(x => x[0]); a.shift();',
  };
  assert.deepEqual(await tscWorkspace(files), []);
  const broken = { ...files, "snake/snake.ts": files["snake/snake.ts"] + ' const wrong: number = "bad";' };
  assert.ok((await tscWorkspace(broken)).some((h) => h.path === "snake/snake.ts" && /number/.test(h.message)));
  assert.deepEqual(await tscWorkspace(files), []);
});
it("resolves inherited config relative to the nested project and keeps project libraries separate", async () => {
  const files = {
    "base.json": '{"compilerOptions":{"lib":["ES2017","DOM"]}}',
    "web/tsconfig.json": '{"extends":"../base.json","include":["src/**/*.ts"],"exclude":["src/ignored.ts"]}',
    "web/src/main.ts": 'export const el: HTMLElement = document.body;',
    "web/src/ignored.ts": 'export const n: number = "wrong";',
    "server/tsconfig.json": '{"compilerOptions":{"lib":["ES2022"]}}',
    "server/main.ts": 'export const el = document.body;',
  };
  const hits = await tscWorkspace(files);
  assert.equal(hits.some((h) => h.path.startsWith("web/")), false, JSON.stringify(hits));
  assert.ok(hits.some((h) => h.path === "server/main.ts" && /document/.test(h.message)));
});
