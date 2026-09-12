import assert from "node:assert/strict";
import { test } from "node:test";
import { detectEngines, enginePrompt, hasEngineHint } from "./engines.ts";

test("nested Unity projects keep their own roots and cannot borrow another project's Assets", () => {
  const hits = detectEngines({
    "games/One/Assets/player.cs": "",
    "games/One/ProjectSettings/ProjectVersion.txt": "",
    "games/Two/ProjectSettings/ProjectVersion.txt": "",
    "unrelated/Assets/readme.txt": "",
  }, ["games/Two/Assets"]);
  assert.deepEqual(hits.map(hit => hit.root), ["games/One", "games/Two"]);
  assert.equal(hits[0].cmds.editor, 'unity -projectPath "games/One"');
  assert.deepEqual(detectEngines({ "One/Assets/player.cs": "", "Two/ProjectSettings/ProjectVersion.txt": "" }), []);
  assert.deepEqual(detectEngines({ "Assets/readme.txt": "", "ProjectSettings/notes.txt": "" }), []);
});

test("every Godot and Unreal project is found and commands run from the workspace", () => {
  const hits = detectEngines({
    "project.godot": "",
    "games/My Game/project.godot": "",
    "games/First/First.uproject": "{}",
    "games/Second/Second.uproject": "{}",
  });
  assert.deepEqual(hits.map(({ id, root }) => [id, root]), [["godot", ""], ["godot", "games/My Game"], ["unreal", "games/First"], ["unreal", "games/Second"]]);
  assert.equal(hits[1].cmds.check, 'godot --headless --path "games/My Game" --import');
  assert.equal(hits[3].cmds.editor, 'UnrealEditor "games/Second/Second.uproject"');
  assert.match(enginePrompt(hits[1]), /workspace directory/i);
});

test("exact project markers and actual Bevy dependency declarations avoid misleading hints", () => {
  const nonProjects: Record<string, string>[] = [
    { "not-project.godot": "", "fakegame.project": "", "NotCargo.toml": "bevy" },
    { "Cargo.toml": '[package]\nname = "bevy-demo"\n# bevy = "0.1"' },
    { "Cargo.toml": '[dependencies]\n# bevy = "0.1"\nserde = "1"' },
    { "main.lua": "", "other/conf.lua": "" },
  ];
  for (const files of nonProjects) {
    assert.deepEqual(detectEngines(files), []);
    assert.equal(hasEngineHint(files), false);
  }
  const hits = detectEngines({
    "One/Cargo.toml": '[dependencies]\nbevy = "0.17"',
    "Two/Cargo.toml": '[dependencies.bevy]\nversion = "0.17"',
    "Three/Cargo.toml": '[dependencies]\nengine = { package = "bevy", version = "0.17" }',
  });
  assert.deepEqual(hits.map(hit => hit.root), ["One", "Two", "Three"]);
  assert.equal(hits[0].cmds.check, 'cargo check --manifest-path "One/Cargo.toml"');
});

test("LÖVE pairs config and entry inside the same project, including nested projects", () => {
  const hits = detectEngines({ "game/main.lua": "", "game/conf.lua": "", "other/main.lua": "", "other/conf.lua": "" });
  assert.deepEqual(hits.map(hit => hit.root), ["game", "other"]);
  assert.equal(hits[0].cmds.play, 'love "game"');
});

test("workspace paths normalize separators and reject absolute or escaping project entries", () => {
  assert.equal(detectEngines({ "games\\demo\\project.godot": "" })[0].root, "games/demo");
  assert.deepEqual(detectEngines({ "../outside/project.godot": "", "C:/outside/project.godot": "", "/outside/project.godot": "" }), []);
});

test("shell expansion in project names never becomes an automatic command", () => {
  for (const root of ['$(touch nope)', 'a" & echo nope', "`id`", "%PATH%", "!PATH!", "line\nbreak"]) {
    const hit = detectEngines({ [`${root}/project.godot`]: "" })[0];
    if (hit) assert.deepEqual(hit.cmds, {});
  }
});
