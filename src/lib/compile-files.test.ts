import assert from "node:assert/strict";
import { test } from "node:test";
import { compileFiles } from "./compile-files.ts";

test("rust bundle includes Cargo.toml", () => {
  const files = compileFiles("rust", "src/main.rs", {
    "src/main.rs": "fn main() {}",
    "Cargo.toml": "[package]\nname=\"a\"\nversion=\"0.1.0\"\nedition=\"2021\"\n",
    "README.md": "x",
  });
  const paths = files.map((f) => f.path).sort();
  assert.deepEqual(paths, ["Cargo.toml", "src/main.rs"]);
});

test("c bundle includes headers and makefile", () => {
  const files = compileFiles("c", "main.c", {
    "main.c": "int main(){}",
    "util.h": "int x;",
    "Makefile": "all:",
    "notes.md": "no",
  });
  const paths = files.map((f) => f.path).sort();
  assert.ok(paths.includes("main.c"));
  assert.ok(paths.includes("util.h"));
  assert.ok(paths.includes("Makefile"));
  assert.ok(!paths.includes("notes.md"));
});

test("go bundle includes go.mod", () => {
  const files = compileFiles("go", "main.go", { "main.go": "package main", "go.mod": "module a\n" });
  assert.ok(files.some((f) => f.path === "go.mod"));
});
