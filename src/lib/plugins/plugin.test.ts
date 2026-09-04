import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isWorkspacePluginPath,
  pluginTrustFromHead,
  pluginWatchPath,
  prunePluginIds,
  vsPackPluginId,
} from "./util.ts";
import { parseHttpFile } from "./http-parse.ts";
import { lintFile } from "./lint.ts";
import { keywordsFromTm, shouldKeepVsixPath } from "./vscode-keep.ts";

describe("plugin paths and trust", () => {
  it("accepts only top-level plugins/*.js", () => {
    assert.equal(isWorkspacePluginPath("plugins/mein-plugin.js"), true);
    assert.equal(isWorkspacePluginPath("plugins/foo/bar.js"), false);
    assert.equal(isWorkspacePluginPath("src/plugins/x.js"), false);
  });
  it("reads @trust from the first 8 lines", () => {
    assert.equal(pluginTrustFromHead("// @desc x\n// @trust\nfunction activate() {}"), true);
    assert.equal(pluginTrustFromHead("// @desc x\nfunction activate() {}"), false);
    const deep = Array.from({ length: 10 }, (_, i) => `// line ${i}`).join("\n") + "\n// @trust\n";
    assert.equal(pluginTrustFromHead(deep), false);
  });
  it("does not watch .anvil for plugin reload", () => {
    assert.equal(pluginWatchPath("plugins/a.js"), true);
    assert.equal(pluginWatchPath(".vscode/foo.code-snippets"), true);
    assert.equal(pluginWatchPath(".anvil/board.json"), false);
    assert.equal(pluginWatchPath(".anvil/harness.json"), false);
  });
  it("prunes ghost ws:/vs: ids, keeps builtins", () => {
    assert.deepEqual(prunePluginIds(["format", "ws:plugins/gone.js", "ws:plugins/a.js"], "ws:", ["ws:plugins/a.js"]), [
      "format",
      "ws:plugins/a.js",
    ]);
    assert.deepEqual(prunePluginIds(["vs:dead", "vs:live"], "vs:", ["vs:live"]), ["vs:live"]);
  });
  it("prefixes vscode pack ids", () => {
    assert.equal(vsPackPluginId("python-snippets"), "vs:python-snippets");
    assert.equal(vsPackPluginId("vs:x"), "vs:x");
  });
});

describe("http parse", () => {
  it("parses method, headers, body and ### blocks", () => {
    const got = parseHttpFile(
      `GET https://example.com/a\nAccept: text/plain\n\n###\nPOST https://example.com/b\nContent-Type: application/json\n\n{"ok":1}`,
    );
    assert.equal(got.length, 2);
    assert.equal(got[0]?.method, "GET");
    assert.equal(got[0]?.url, "https://example.com/a");
    assert.equal(got[0]?.headers.Accept, "text/plain");
    assert.equal(got[1]?.method, "POST");
    assert.equal(got[1]?.body, '{"ok":1}');
  });
  it("falls back to the first URL as GET", () => {
    const got = parseHttpFile("see https://example.com/x for docs");
    assert.equal(got[0]?.method, "GET");
    assert.equal(got[0]?.url, "https://example.com/x");
  });
});

describe("lint", () => {
  it("reports unmatched brackets outside strings", () => {
    const hits = lintFile("a.js", 'const s = "(";\nfoo(\n');
    assert.ok(hits.some((h) => /fehlende/.test(h.text)));
    assert.equal(
      lintFile("a.js", 'const s = ")";\n').some((h) => /unerwartete/.test(h.text)),
      false,
    );
  });
  it("flags mixed indent and bad json", () => {
    assert.ok(lintFile("a.js", "\tfoo\n  bar\n").some((h) => /Tabs/.test(h.text)));
    assert.ok(lintFile("a.json", "{").length > 0);
  });
});

describe("vsix keep and tm keywords", () => {
  it("keeps snippets, languages, tmLanguage; drops js", () => {
    assert.equal(shouldKeepVsixPath("package.json"), true);
    assert.equal(shouldKeepVsixPath("syntaxes/foo.tmLanguage.json"), true);
    assert.equal(shouldKeepVsixPath("snippets/python.json"), true);
    assert.equal(shouldKeepVsixPath("language-configuration.json"), true);
    assert.equal(shouldKeepVsixPath("out/extension.js"), false);
    assert.equal(shouldKeepVsixPath("node_modules/x/package.json"), false);
  });
  it("extracts keyword matches from a tm grammar", () => {
    const kws = keywordsFromTm({
      patterns: [{ name: "keyword.control.foo", match: "\\b(def|class|yield)\\b" }],
    });
    assert.ok(kws.includes("def"));
    assert.ok(kws.includes("class"));
    assert.ok(kws.includes("yield"));
  });
});
