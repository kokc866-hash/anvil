import assert from "node:assert/strict";
import { test } from "node:test";
import { autoCollapsePaths, buildTree, isPinnedPath } from "./fs.ts";

test("pins .anvil and ref above project files, with their children", () => {
  const tree = buildTree(
    ["index.html", "css/style.css", "ref/README.md", ".anvil/rules.md", "js/util.js"],
    [".anvil", "css", "js", "ref"],
  );
  const paths = tree.map((n) => n.path);
  const anvil = paths.indexOf(".anvil");
  const rules = paths.indexOf(".anvil/rules.md");
  const ref = paths.indexOf("ref");
  const readme = paths.indexOf("ref/README.md");
  const css = paths.indexOf("css");
  assert.ok(anvil < rules && rules < ref && ref < readme);
  assert.ok(readme < css);
  assert.ok(isPinnedPath(".anvil/rules.md"));
  assert.equal(isPinnedPath("css/style.css"), false);
});

test("auto-collapses nested folders in medium trees", () => {
  const files = ["src/a/b/c.ts", "src/a/b/d.ts", "lib/x.ts"];
  const closed = autoCollapsePaths(files, "src/a/b/c.ts", 2);
  assert.ok(closed.includes("lib"));
  assert.equal(closed.includes("src"), false);
  assert.equal(closed.includes("src/a"), false);
  assert.equal(closed.includes("src/a/b"), false);
});
