import assert from "node:assert/strict";
import { describe, it } from "node:test";

function grep(query, files) {
  let re = null;
  try {
    re = new RegExp(query, "i");
  } catch {
    re = null;
  }
  const q = query.toLowerCase();
  const hits = [];
  for (const [path, content] of files) {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const ok = re ? re.test(lines[i]) : lines[i].toLowerCase().includes(q);
      if (ok) hits.push(`${path}:${i + 1}`);
    }
  }
  return hits;
}

describe("grep regex", () => {
  it("finds substring and regex", () => {
    const files = new Map([
      ["a.py", "foo = 1\nbar = 2\n"],
      ["b.ts", "const fooBar = 3;\n"],
    ]);
    assert.ok(grep("foo", files).some((h) => h.startsWith("a.py:1")));
    assert.ok(grep("fooB.r", files).some((h) => h.startsWith("b.ts")));
  });
});

describe("js debug depth", () => {
  it("skips await inside braces", () => {
    const code = "const a = 1;\nfunction add(x) {\n  return x + 1;\n}\nadd(a);\n";
    let depth = 0;
    const out = [];
    for (const line of code.split("\n")) {
      const t = line.trim();
      const opens = (line.match(/\{/g) ?? []).length;
      const closes = (line.match(/\}/g) ?? []).length;
      const skip = !t || t.startsWith("function") || t.startsWith("return");
      out.push(!skip && depth === 0 ? "AWAIT " + line : line);
      depth = Math.max(0, depth + opens - closes);
    }
    const src = out.join("\n");
    assert.match(src, /AWAIT const a/);
    assert.equal(src.includes("AWAIT   return"), false);
  });
});
