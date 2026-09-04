import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSecretPath,
  omitSecrets,
  isRefPath,
  isRefImage,
  uniqueRefPath,
  packRefContext,
  copyIntoRef,
  refWriteBlocked,
  rewriteRefMedia,
  modelSeesImages,
  imageStub,
  REF_DIR,
} from "./ref.ts";
import { skipPath } from "./ws-skip.ts";

function agentVisible(path: string): boolean {
  if (isSecretPath(path)) return false;
  if (isRefPath(path)) return true;
  return !skipPath(path);
}

describe("isSecretPath", () => {
  it("treats env and keys as secrets, examples as not", () => {
    assert.equal(isSecretPath(".env"), true);
    assert.equal(isSecretPath("src/.env.local"), true);
    assert.equal(isSecretPath(".env.example"), false);
    assert.equal(isSecretPath(".env.sample"), false);
    assert.equal(isSecretPath(".env.template"), false);
    assert.equal(isSecretPath("id_rsa"), true);
    assert.equal(isSecretPath("certs/foo.pem"), true);
    assert.equal(isSecretPath("password.txt"), true);
    assert.equal(isSecretPath("api-key.json"), true);
    assert.equal(isSecretPath("secrets/prod.json"), true);
  });
  it("does not treat source files as secrets", () => {
    assert.equal(isSecretPath("src/password.ts"), false);
    assert.equal(isSecretPath("api-key.ts"), false);
    assert.equal(isSecretPath("vault.md"), false);
  });
  it("omitSecrets drops env", () => {
    const out = omitSecrets({ ".env": "K=1", "a.ts": "x", ".env.example": "K=" });
    assert.equal(".env" in out, false);
    assert.equal(out["a.ts"], "x");
    assert.equal(out[".env.example"], "K=");
  });
  it("agent list hides secrets and vendor, shows ref images", () => {
    assert.equal(agentVisible("a.ts"), true);
    assert.equal(agentVisible(".env.example"), true);
    assert.equal(agentVisible(".env"), false);
    assert.equal(agentVisible("node_modules/foo/index.js"), false);
    assert.equal(agentVisible("src/password.ts"), true);
    assert.equal(agentVisible("ref/shot.png"), true);
    assert.equal(agentVisible("logo.png"), false);
  });
});

describe("ref paths", () => {
  it("uniqueRefPath keeps folders", () => {
    const files = { "ref/README.md": "x" };
    assert.equal(uniqueRefPath(files, "ui/shot.png"), "ref/ui/shot.png");
    assert.equal(uniqueRefPath({ "ref/ui/shot.png": "x" }, "ui/shot.png"), "ref/ui/shot-2.png");
  });
  it("isRefImage detects data urls and svg", () => {
    assert.equal(isRefImage("data:image/png;base64,aaa"), true);
    assert.equal(isRefImage("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), true);
    assert.equal(isRefImage("# spec"), false);
  });
  it("copyIntoRef blocks secrets and copies basename", () => {
    const files = { ".env": "K=1", "src/spec.md": "# s" };
    const bad = copyIntoRef(files, ".env");
    assert.equal("error" in bad, true);
    const ok = copyIntoRef(files, "src/spec.md");
    assert.equal("path" in ok && ok.path, "ref/spec.md");
  });
  it("refWriteBlocked rejects new source in ref/", () => {
    assert.equal(refWriteBlocked("src/a.ts", "x", false), null);
    assert.equal(refWriteBlocked("ref/a.ts", "x", false)?.includes("ref/"), true);
    assert.equal(refWriteBlocked("ref/spec.md", "# s", false), null);
    assert.equal(refWriteBlocked("ref/a.ts", "x", true), null);
  });
  it("packRefContext caps the index and prefers attached", () => {
    const files: Record<string, string> = { "ref/README.md": "# Referenzen\n" };
    for (let i = 0; i < 30; i++) files[`ref/n${String(i).padStart(2, "0")}.md`] = `# N${i}\nlogin screen`;
    const packed = packRefContext(files, "login bauen", ["ref/n05.md"]);
    assert.match(packed.text, /ref\/n05\.md/);
    assert.match(packed.text, /weitere — list_files/);
    assert.match(packed.text, /read_file/);
    const lines = packed.text.split("\n").filter((l) => l.startsWith("- ref/"));
    assert.ok(lines.length <= 24);
  });
  it("rewriteRefMedia inlines css url and ./ref/", () => {
    const files = { "ref/a.png": "data:image/png;base64,aaa" };
    const css = "body{background:url(ref/a.png)}";
    assert.match(rewriteRefMedia(css, files), /data:image\/png/);
    const md = "![x](./ref/a.png)";
    assert.match(rewriteRefMedia(md, files), /data:image\/png/);
  });
  it("modelSeesImages is true for grok, false for plain ollama llama", () => {
    assert.equal(modelSeesImages("grok", "grok-4"), true);
    assert.equal(modelSeesImages("ollama", "llama3.1"), false);
    assert.equal(modelSeesImages("ollama", "llava"), true);
  });
  it("imageStub is short", () => {
    const s = imageStub("ref/a.png", "data:image/png;base64," + "a".repeat(1000));
    assert.ok(s.length < 200);
    assert.match(s, /image/);
  });
});
