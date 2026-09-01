import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyPatchToFiles, parsePatch } from "./patch.ts";

describe("patch", () => {
  it("applies json files", () => {
    const plan = parsePatch(JSON.stringify({ v: 1, note: "x", files: { "a.ts": "hi\n" }, delete: ["old.ts"] }));
    assert.equal(plan.write["a.ts"], "hi\n");
    const next = applyPatchToFiles({ "old.ts": "z", "keep.ts": "k" }, plan);
    assert.equal(next["a.ts"], "hi\n");
    assert.equal(next["old.ts"], undefined);
    assert.equal(next["keep.ts"], "k");
  });
  it("applies anvil format", () => {
    const plan = parsePatch(`ANVIL-PATCH 1
NOTE demo
FILE src/x.ts <<END
export const n = 1;
END
DELETE gone.ts
`);
    assert.equal(plan.note, "demo");
    assert.match(plan.write["src/x.ts"], /export const n/);
    assert.deepEqual(plan.del, ["gone.ts"]);
  });
  it("applies unified new file", () => {
    const plan = parsePatch(`--- /dev/null
+++ b/src/n.ts
@@ -0,0 +1,2 @@
+a
+b
`);
    assert.equal(plan.write["src/n.ts"].trim(), "a\nb");
  });
});
