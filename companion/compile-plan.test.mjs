import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ccArgs, javaMainClass, nativeSources, isCargo, isGoMod, firstCsproj, looksGui } from "./compile-plan.mjs";

describe("compile-plan", () => {
  it("compiles all C++ units plus include dirs", () => {
    const files = [{ path: "src/main.cpp" }, { path: "src/util.cpp" }, { path: "include/util.hpp" }];
    const { srcs, inc } = nativeSources(files, "cpp", "src/main.cpp");
    assert.deepEqual(srcs, ["src/main.cpp", "src/util.cpp"]);
    assert.deepEqual(inc, ["include"]);
    const args = ccArgs("/tools/zig/zig.exe", "cpp", "src/main.cpp", files, "out.exe");
    assert.equal(args[0], "c++");
    assert.ok(args.includes("src/util.cpp"));
    assert.ok(args.includes("-Iinclude"));
    assert.ok(args.includes("-o"));
  });
  it("plain gcc gets no zig subcommand", () => {
    const args = ccArgs("gcc", "c", "a.c", [{ path: "a.c" }], "out");
    assert.equal(args[0], "a.c");
    assert.ok(!args.includes("cc"));
  });
  it("java main uses package", () => {
    assert.equal(javaMainClass("com/app/Main.java", "package com.app;\nclass Main {}"), "com.app.Main");
    assert.equal(javaMainClass("Main.java", "class Main {}"), "Main");
  });
  it("detects cargo / go.mod / csproj", () => {
    assert.equal(isCargo([{ path: "Cargo.toml" }, { path: "src/main.rs" }]), true);
    assert.equal(isGoMod([{ path: "cmd/app.go" }]), false);
    assert.equal(isGoMod([{ path: "go.mod" }]), true);
    assert.equal(firstCsproj([{ path: "App.csproj" }, { path: "Program.cs" }]), "App.csproj");
  });
  it("detects native GUI sources", () => {
    assert.equal(looksGui([{ path: "main.cpp", content: "int WinMain() { return 0; }" }]), true);
    assert.equal(looksGui([{ path: "game.py", content: "import pygame\npygame.init()\n" }]), true);
    assert.equal(looksGui([{ path: "ui.py", content: "import tkinter as tk\n" }]), true);
    assert.equal(looksGui([{ path: "main.c", content: "int main() { return 0; }" }]), false);
  });
});
