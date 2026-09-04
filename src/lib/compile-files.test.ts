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

test("python bundle includes sibling modules", () => {
  const files = compileFiles("python", "src/app.py", {
    "src/app.py": "import util",
    "src/util.py": "x=1",
    "README.md": "no",
  });
  const paths = files.map((f) => f.path).sort();
  assert.ok(paths.includes("src/app.py"));
  assert.ok(paths.includes("src/util.py"));
  assert.ok(!paths.includes("README.md"));
});

test("keeps more than 80 same-language files", () => {
  const files: Record<string, string> = { "main.go": "package main" };
  for (let i = 0; i < 90; i++) files[`f${i}.go`] = "package f";
  const got = compileFiles("go", "main.go", files);
  assert.equal(got.length, 91);
});

test("decodes u003c in C++ snapshot before compile", () => {
  const files = compileFiles("cpp", "main.cpp", {
    "main.cpp": "#include u003ciostreamu003e\nint main(){return 0;}\n",
    "util.hpp": "int add(int a, int b);\n",
  });
  const main = files.find((f) => f.path === "main.cpp");
  assert.match(main?.content ?? "", /#include <iostream>/);
});
