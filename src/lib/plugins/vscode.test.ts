import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSnippetFile } from "./vscode-snip.ts";

describe("vscode snippets", () => {
  it("parses vscode snippet json", () => {
    const got = parseSnippetFile(
      JSON.stringify({
        For: { prefix: "for", body: ["for (const ${1:x} of ${2:xs}) {", "\t$0", "}"] },
      }),
      "javascript",
    );
    assert.equal(got[0]?.prefix, "for");
    assert.ok(got[0]?.body.includes("const x of xs"));
    assert.equal(got[0]?.body.includes("$0"), false);
  });
  it("honors scope list", () => {
    const got = parseSnippetFile(
      JSON.stringify({ Log: { prefix: "log", body: "console.log()", scope: "javascript,typescript" } }),
    );
    assert.equal(got.length, 2);
    assert.ok(got.some((s) => s.lang === "typescript"));
  });
});
