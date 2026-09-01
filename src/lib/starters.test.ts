import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBareWorkspace, mergeStarter, starterOf } from "./starters-core.ts";
import { SEED_FILES } from "./seed-files.ts";

describe("starters", () => {
  it("bare seed only", () => {
    assert.equal(isBareWorkspace({ ...SEED_FILES }), true);
    assert.equal(isBareWorkspace({ ...SEED_FILES, "src/app.py": "x" }), false);
  });
  it("merge keeps user files", () => {
    const cur = { ...SEED_FILES, "notes.md": "keep" };
    const next = mergeStarter(cur, "python", false, SEED_FILES);
    assert.equal(next["notes.md"], "keep");
    assert.ok(next["src/app.py"]?.includes("clip"));
    assert.ok(next["tests/test_app.py"]?.includes("test_clip"));
  });
  it("replace uses seed plus starter", () => {
    const next = mergeStarter({ ...SEED_FILES, "old.py": "x" }, "web", true, SEED_FILES);
    assert.equal(next["old.py"], undefined);
    assert.equal(starterOf("web").main, "index.html");
    assert.ok(starterOf("csharp").files["Program.cs"]?.includes("Clip"));
    assert.ok(starterOf("php").files["index.php"]?.includes("clip"));
    assert.ok(starterOf("ruby").files["main.rb"]?.includes("clip"));
    assert.ok(starterOf("go").files["main.go"]?.includes("package main"));
  });
});
