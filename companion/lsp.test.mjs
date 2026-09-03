import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LSP_CATALOG, jsEntry, listLsp } from "./lsp.mjs";

describe("free LSP catalog", () => {
  it("only known free packs, pull by id", () => {
    const ids = LSP_CATALOG.map((p) => p.id);
    assert.ok(ids.includes("pyright"));
    assert.ok(ids.includes("typescript"));
    assert.ok(ids.includes("html"));
    assert.ok(ids.includes("yaml"));
    assert.ok(ids.includes("gopls"));
    assert.ok(ids.includes("rust"));
    assert.ok(ids.includes("clangd"));
    assert.ok(ids.includes("java"));
    assert.ok(!ids.includes("intelephense"));
  });
  it("list has ready flags", () => {
    const rows = listLsp();
    assert.ok(rows.length >= 5);
    for (const r of rows) {
      assert.equal(typeof r.ready, "boolean");
      assert.ok(r.license);
    }
  });
});

describe("jsEntry", () => {
  it("prefers package.json bin when it is a .js file", () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "anvil-lsp-"));
    try {
      const dir = path.join(home, "node_modules", "yaml-language-server");
      mkdirSync(path.join(dir, "out", "server", "src"), { recursive: true });
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({ bin: { "yaml-language-server": "bin/yaml-language-server" } }));
      writeFileSync(path.join(dir, "out", "server", "src", "server.js"), "console.log('ok')");
      const spec = LSP_CATALOG.find((p) => p.id === "yaml");
      const hit = jsEntry(spec, home);
      assert.equal(hit, path.join(dir, "out", "server", "src", "server.js"));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("uses html fallback when the unix bin has no extension", () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "anvil-lsp-"));
    try {
      const dir = path.join(home, "node_modules", "vscode-langservers-extracted");
      mkdirSync(path.join(dir, "lib", "html-language-server", "node"), { recursive: true });
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({ bin: { "vscode-html-language-server": "bin/vscode-html-language-server" } }));
      mkdirSync(path.join(dir, "bin"), { recursive: true });
      writeFileSync(path.join(dir, "bin", "vscode-html-language-server"), "#!/usr/bin/env node\n");
      writeFileSync(path.join(dir, "lib", "html-language-server", "node", "htmlServerMain.js"), "console.log('html')");
      const spec = LSP_CATALOG.find((p) => p.id === "html");
      const hit = jsEntry(spec, home);
      assert.ok(hit.endsWith("htmlServerMain.js"));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("keeps shebang bin when no compiled entry exists", () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "anvil-lsp-"));
    try {
      const dir = path.join(home, "node_modules", "yaml-language-server");
      mkdirSync(path.join(dir, "bin"), { recursive: true });
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({ bin: { "yaml-language-server": "bin/yaml-language-server" } }));
      writeFileSync(path.join(dir, "bin", "yaml-language-server"), "#!/usr/bin/env node\nconsole.log(1)\n");
      const spec = LSP_CATALOG.find((p) => p.id === "yaml");
      const hit = jsEntry(spec, home);
      assert.ok(hit.endsWith("yaml-language-server"));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
