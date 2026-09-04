import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripZipRoot, extractPdfText, bytesToDataUrl } from "./archive.ts";

describe("stripZipRoot", () => {
  it("keeps config dots after stripping the repo folder", () => {
    const out = stripZipRoot({
      "repo/.github/workflows/ci.yml": "on: push",
      "repo/.gitignore": "node_modules",
      "repo/.secret": "no",
      "repo/src/a.ts": "x",
    });
    assert.equal(out[".github/workflows/ci.yml"], "on: push");
    assert.equal(out[".gitignore"], "node_modules");
    assert.equal(".secret" in out, false);
    assert.equal(out["src/a.ts"], "x");
  });
  it("leaves mixed roots alone", () => {
    const files = { "a/x.ts": "1", "b/y.ts": "2" };
    assert.deepEqual(stripZipRoot(files), files);
  });
});

describe("pdf and data url", () => {
  it("extracts literal strings from a fake pdf", () => {
    const raw = "%PDF-1.4\nBT (Hello spec) Tj ET";
    const buf = new Uint8Array([...raw].map((c) => c.charCodeAt(0)));
    assert.match(extractPdfText(buf), /Hello spec/);
  });
  it("bytesToDataUrl prefixes mime", () => {
    const url = bytesToDataUrl(new Uint8Array([1, 2, 3]), "image/png");
    assert.match(url, /^data:image\/png;base64,/);
  });
});
