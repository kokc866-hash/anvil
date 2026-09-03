import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defsAt, hoverFor, lintWorkspace, renameSymbol, wordAt } from "./lsp.ts";

describe("lsp", () => {
  it("lints an open file over 200k", () => {
    const big = `${"x = 1\n".repeat(40_000)}def hi(\n`;
    assert.ok(big.length > 200_000);
    const hits = lintWorkspace({ "a.py": big }, ["a.py"]);
    assert.ok(hits.some((h) => h.path === "a.py"));
  });
  it("skips a closed file over 400k", () => {
    const big = `${"x = 1\n".repeat(80_000)}def hi(\n`;
    const hits = lintWorkspace({ "a.py": big }, []);
    assert.equal(hits.length, 0);
  });
  it("rename walks definitions and imports", () => {
    const files = {
      "src/util.ts": "export function add(a: number) { return a + 1; }\n",
      "src/main.ts": "import { add } from './util';\nadd(1);\n",
    };
    const src = files["src/main.ts"];
    const r = renameSymbol(files, "src/main.ts", src.indexOf("add"), "sum");
    assert.ok(!("error" in r));
    if ("error" in r) return;
    assert.match(r.files["src/util.ts"] ?? "", /function sum/);
    assert.match(r.files["src/main.ts"] ?? "", /import \{ sum \}/);
    assert.match(r.files["src/main.ts"] ?? "", /sum\(1\)/);
  });
  it("hover without tsc is labeled approx", () => {
    const files = { "a.py": "def ping():\n  return 1\n" };
    const md = hoverFor(files, "a.py", files["a.py"], files["a.py"].indexOf("ping"));
    assert.match(String(md), /Näherung/);
    assert.equal(wordAt("def ping():", 4), "ping");
  });
  it("defsAt falls back to the index for python", async () => {
    const src = "def ping():\n  return 1\n\nping()\n";
    const defs = await defsAt({ "a.py": src }, "a.py", src.lastIndexOf("ping"));
    assert.ok(defs.some((d) => d.path === "a.py" && d.line === 1));
  });
});
