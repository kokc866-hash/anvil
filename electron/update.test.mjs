import assert from "node:assert/strict";
import { test } from "node:test";
import { cmpVer, pickAssets } from "./update-parse.mjs";

test("cmpVer orders 1.2.9 below 1.3.0", () => {
  assert.equal(cmpVer("1.3.0", "1.2.9"), 1);
  assert.equal(cmpVer("v1.2.9", "1.2.9"), 0);
  assert.equal(cmpVer("1.2.8", "1.2.9"), -1);
});

test("pickAssets prefers Setup exe and zip", () => {
  const a = pickAssets([
    { name: "Anvil-1.3.0-win.zip", browser_download_url: "https://example/z" },
    { name: "Anvil.Setup.1.3.0.exe", browser_download_url: "https://example/s" },
    { name: "notes.txt", browser_download_url: "https://example/n" },
  ]);
  assert.equal(a.zipUrl, "https://example/z");
  assert.equal(a.setupUrl, "https://example/s");
});
