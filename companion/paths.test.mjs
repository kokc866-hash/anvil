import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

describe("package home", () => {
  it("setAnvilHome creates toolchains and lsp", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "anvil-home-"));
    const pointer = path.join(dir, "home.txt");
    const dest = path.join(dir, "pkgs");
    process.env.ANVIL_HOME_FILE = pointer;
    delete process.env.ANVIL_HOME;
    delete process.env.ANVIL_TOOLCHAIN_HOME;
    delete process.env.ANVIL_LSP_HOME;
    try {
      const { setAnvilHome, toolHome, lspHome, anvilHome } = await import("./paths.mjs");
      const snap = setAnvilHome(dest);
      assert.equal(anvilHome(), dest);
      assert.equal(toolHome(), path.join(dest, "toolchains"));
      assert.equal(lspHome(), path.join(dest, "lsp"));
      assert.equal(snap.toolchains, toolHome());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
