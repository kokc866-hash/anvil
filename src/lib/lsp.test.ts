import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defsAt, hoverFor, lintWorkspace, listSymbols, renameSymbol, wordAt } from "./lsp.ts";

describe("lsp", () => {
  it("keeps symbol locations across blank lines and CRLF", () => {
    const src = "const first = 1;\r\n\r\nexport function ping() {}\r\nclass Box {}\r\n";
    assert.deepEqual(listSymbols(src, "src/symbols.ts"), [
      { path: "src/symbols.ts", line: 1, text: "const first = 1;" },
      { path: "src/symbols.ts", line: 3, text: "export function ping() {}" },
      { path: "src/symbols.ts", line: 4, text: "class Box {}" },
    ]);
  });
  it("reuses symbol results for unchanged text and refreshes same-length edits", () => {
    const a = "const alpha = 1;\n", b = "const bravo = 1;\n";
    const first = listSymbols(a, "cached.ts");
    assert.equal(listSymbols(a, "cached.ts"), first);
    listSymbols("def other():\n  pass\n", "other.py");
    assert.equal(listSymbols(a, "cached.ts"), first, "switching tabs retains the current text revision");
    const second = listSymbols(b, "cached.ts");
    assert.notEqual(second, first);
    assert.deepEqual(second, [{ path: "cached.ts", line: 1, text: "const bravo = 1;" }]);
  });
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
    assert.match(String(md), /Mögliche Deklaration/);
    assert.match(String(md), /nicht durch einen Sprachdienst geprüft/);
    assert.match(String(md), /a\.py:1/);
    assert.equal(wordAt("def ping():", 4), "ping");
  });
  it("does not invent hover information for unknown names", () => {
    assert.equal(hoverFor({ "a.py": "missing()" }, "a.py", "missing()", 2), null);
  });
  it("keeps source literal and localizes the fallback explanation", () => {
    const src = 'def ping(): # ``` **literal**';
    const md = hoverFor({ "a.py": src }, "a.py", src, 5, "en");
    assert.match(md!, /Possible declaration/);
    assert.ok(md!.includes('````\ndef ping(): # ``` **literal**\n````'));
    assert.match(md!, /have not been verified/);
  });
  it("defsAt falls back to the index for python", async () => {
    const src = "def ping():\n  return 1\n\nping()\n";
    const defs = await defsAt({ "a.py": src }, "a.py", src.lastIndexOf("ping"));
    assert.ok(defs.some((d) => d.path === "a.py" && d.line === 1));
  });
});
