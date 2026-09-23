import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

describe("package home", () => {
  it('uses the package directory selected after module import and follows later changes', async () => {
    const paths = await import('./paths.mjs?late-home-fixture');
    const previous = { home: process.env.ANVIL_HOME, tools: process.env.ANVIL_TOOLCHAIN_HOME, lsp: process.env.ANVIL_LSP_HOME };
    try {
      delete process.env.ANVIL_TOOLCHAIN_HOME; delete process.env.ANVIL_LSP_HOME;
      for (const folder of ['first-profile', 'second-profile']) {
        const current = path.join(os.tmpdir(), 'anvil-home-fixture', folder);
        process.env.ANVIL_HOME = current;
        assert.equal(paths.anvilHome(), current);
        assert.equal(paths.toolHome(), path.join(current, 'toolchains'));
        assert.equal(paths.lspHome(), path.join(current, 'lsp'));
      }
    } finally {
      for (const [key, value] of Object.entries({ ANVIL_HOME: previous.home, ANVIL_TOOLCHAIN_HOME: previous.tools, ANVIL_LSP_HOME: previous.lsp })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
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
