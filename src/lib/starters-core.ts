export type StarterId = string;

export type Starter = {
  id: StarterId;
  label: string;
  group: "live" | "remote";
  main: string;
  files: Record<string, string>;
};

function harness(name: string, afterWrite: "run" | "preview"): string {
  return `${JSON.stringify({ name, when: `Nach Write ${afterWrite}`, runLoop: true, graphLoop: false, afterWrite, loopTries: 3 }, null, 2)}\n`;
}

const WEB: Record<string, string> = {
  "index.html": `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>App</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main>
      <h1>App</h1>
      <p id="out"></p>
    </main>
    <script src="app.js"></script>
  </body>
</html>
`,
  "style.css": `html, body { margin: 0; font: 16px/1.4 system-ui, sans-serif; }
main { max-width: 40rem; margin: 3rem auto; padding: 0 1.25rem; }
h1 { font-size: 1.5rem; }
`,
  "app.js": `const el = document.getElementById("out");
if (el) el.textContent = "Bereit.";
`,
  ".anvil/harness.json": harness("web", "preview"),
};

const PY: Record<string, string> = {
  "src/__init__.py": "",
  "src/app.py": `def clip(n: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, n))


if __name__ == "__main__":
    print(clip(9, 0, 3))
`,
  "tests/test_app.py": `def clip(n, lo, hi):
    return max(lo, min(hi, n))


def test_clip():
    assert clip(9, 0, 3) == 3
    assert clip(-1, 0, 3) == 0
`,
  ".anvil/harness.json": harness("python", "run"),
};

const JS: Record<string, string> = {
  "src/main.js": `export function clip(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

console.log(clip(9, 0, 3));
`,
  "src/main.test.js": `import { clip } from "./main.js";

test("clip", () => {
  if (clip(9, 0, 3) !== 3) throw new Error("hi");
  if (clip(-1, 0, 3) !== 0) throw new Error("lo");
});
`,
  ".anvil/harness.json": harness("javascript", "run"),
};

const TS: Record<string, string> = {
  "src/main.ts": `export function clip(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

console.log(clip(9, 0, 3));
`,
  "src/main.test.ts": `import { clip } from "./main.ts";

test("clip", () => {
  if (clip(9, 0, 3) !== 3) throw new Error("hi");
  if (clip(-1, 0, 3) !== 0) throw new Error("lo");
});
`,
  ".anvil/harness.json": harness("node", "run"),
};

function remote(id: string, main: string, src: string): Record<string, string> {
  return {
    [main]: src,
    ".anvil/harness.json": harness(id, "run"),
  };
}

export const STARTERS: Starter[] = [
  { id: "web", label: "Web", group: "live", main: "index.html", files: WEB },
  { id: "python", label: "Python", group: "live", main: "src/app.py", files: PY },
  { id: "javascript", label: "JavaScript", group: "live", main: "src/main.js", files: JS },
  { id: "node", label: "TypeScript", group: "live", main: "src/main.ts", files: TS },
  {
    id: "go",
    label: "Go",
    group: "remote",
    main: "main.go",
    files: remote(
      "go",
      "main.go",
      `package main

import "fmt"

func clip(n, lo, hi int) int {
	if n < lo {
		return lo
	}
	if n > hi {
		return hi
	}
	return n
}

func main() {
	fmt.Println(clip(9, 0, 3))
}
`,
    ),
  },
  {
    id: "rust",
    label: "Rust",
    group: "remote",
    main: "main.rs",
    files: remote(
      "rust",
      "main.rs",
      `fn clip(n: i32, lo: i32, hi: i32) -> i32 {
    n.max(lo).min(hi)
}

fn main() {
    println!("{}", clip(9, 0, 3));
}
`,
    ),
  },
  {
    id: "java",
    label: "Java",
    group: "remote",
    main: "Main.java",
    files: remote(
      "java",
      "Main.java",
      `public class Main {
    static int clip(int n, int lo, int hi) {
        return Math.max(lo, Math.min(hi, n));
    }
    public static void main(String[] args) {
        System.out.println(clip(9, 0, 3));
    }
}
`,
    ),
  },
  {
    id: "c",
    label: "C",
    group: "remote",
    main: "main.c",
    files: remote(
      "c",
      "main.c",
      `#include <stdio.h>

int clip(int n, int lo, int hi) {
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
}

int main(void) {
    printf("%d\\n", clip(9, 0, 3));
    return 0;
}
`,
    ),
  },
  {
    id: "cpp",
    label: "C++",
    group: "remote",
    main: "main.cpp",
    files: remote(
      "cpp",
      "main.cpp",
      `#include <algorithm>
#include <iostream>

int clip(int n, int lo, int hi) {
    return std::max(lo, std::min(hi, n));
}

int main() {
    std::cout << clip(9, 0, 3) << "\\n";
    return 0;
}
`,
    ),
  },
  {
    id: "csharp",
    label: "C#",
    group: "remote",
    main: "Program.cs",
    files: remote(
      "csharp",
      "Program.cs",
      `using System;

class Program {
    static int Clip(int n, int lo, int hi) {
        return Math.Max(lo, Math.Min(hi, n));
    }
    static void Main() {
        Console.WriteLine(Clip(9, 0, 3));
    }
}
`,
    ),
  },
  {
    id: "php",
    label: "PHP",
    group: "remote",
    main: "index.php",
    files: remote(
      "php",
      "index.php",
      `<?php
function clip(int $n, int $lo, int $hi): int {
    return max($lo, min($hi, $n));
}

echo clip(9, 0, 3), PHP_EOL;
`,
    ),
  },
  {
    id: "ruby",
    label: "Ruby",
    group: "remote",
    main: "main.rb",
    files: remote(
      "ruby",
      "main.rb",
      `def clip(n, lo, hi)
  [[n, lo].max, hi].min
end

puts clip(9, 0, 3)
`,
    ),
  },
];

export function starterOf(id: StarterId): Starter {
  return STARTERS.find((s) => s.id === id) ?? STARTERS[0]!;
}

const SEED_KEYS = [".anvil/rules.md", "ref/README.md", "README.md"];

export function isBareWorkspace(files: Record<string, string>, seedKeys = SEED_KEYS): boolean {
  return Object.keys(files).every((p) => seedKeys.includes(p));
}

export function mergeStarter(
  cur: Record<string, string>,
  id: StarterId,
  replace: boolean,
  seed: Record<string, string>,
): Record<string, string> {
  const extra = starterOf(id).files;
  if (replace || isBareWorkspace(cur, Object.keys(seed))) return { ...seed, ...extra };
  const next = { ...cur };
  for (const [p, c] of Object.entries(extra)) {
    const old = cur[p];
    if (old == null || old === seed[p]) next[p] = c;
  }
  return next;
}
