import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INSTALL, installerKind, installBin } from "./install.mjs";

describe("companion install allowlist", () => {
  it("only known bins", () => {
    assert.ok(INSTALL.go.id);
    assert.equal(INSTALL.rustc.id, INSTALL.cargo.id);
    assert.equal(INSTALL.java.id, INSTALL.javac.id);
  });
  it("rejects unknown bin", async () => {
    const r = await installBin("rm");
    assert.equal(r.ok, false);
    assert.match(String(r.stderr), /Kein Installer|rm/);
  });
  it("installerKind is string or null", () => {
    const k = installerKind();
    assert.ok(k === null || k === "winget" || k === "scoop" || k === "choco");
  });
});
