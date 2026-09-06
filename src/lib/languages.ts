import { vscodeExt } from "@/lib/plugins/vscode";
import { isExecutablePath } from "./run-target";

export type LangId =
  | "python"
  | "javascript"
  | "typescript"
  | "go"
  | "rust"
  | "java"
  | "c"
  | "cpp"
  | "csharp"
  | "php"
  | "ruby"
  | "html"
  | "css"
  | "markdown"
  | "json"
  | "plaintext";

export type RunKind = "browser" | "remote" | "preview" | "none";

export type LangMeta = {
  id: LangId;
  label: string;
  ext: string;
  run: RunKind;
  samplePath: string;
  template: string;
};

export const LANGS: LangMeta[] = [
  {
    id: "python",
    label: "Python",
    ext: "py",
    run: "browser",
    samplePath: "main.py",
    template: `def main() -> None:
    pass


if __name__ == "__main__":
    main()
`,
  },
  {
    id: "javascript",
    label: "JavaScript",
    ext: "js",
    run: "browser",
    samplePath: "main.js",
    template: `function main() {
}

main();
`,
  },
  {
    id: "typescript",
    label: "TypeScript",
    ext: "ts",
    run: "browser",
    samplePath: "main.ts",
    template: `function main(): void {
}

main();
`,
  },
  {
    id: "go",
    label: "Go",
    ext: "go",
    run: "remote",
    samplePath: "main.go",
    template: `package main

func main() {
}
`,
  },
  {
    id: "rust",
    label: "Rust",
    ext: "rs",
    run: "remote",
    samplePath: "main.rs",
    template: `fn main() {
}
`,
  },
  {
    id: "java",
    label: "Java",
    ext: "java",
    run: "remote",
    samplePath: "Main.java",
    template: `public class Main {
    public static void main(String[] args) {
    }
}
`,
  },
  {
    id: "cpp",
    label: "C++",
    ext: "cpp",
    run: "remote",
    samplePath: "main.cpp",
    template: `#include <iostream>

int main() {
    return 0;
}
`,
  },
  {
    id: "c",
    label: "C",
    ext: "c",
    run: "remote",
    samplePath: "main.c",
    template: `#include <stdio.h>

int main(void) {
    return 0;
}
`,
  },
  {
    id: "csharp",
    label: "C#",
    ext: "cs",
    run: "remote",
    samplePath: "Program.cs",
    template: `using System;

class Program {
    static void Main() {
    }
}
`,
  },
  {
    id: "php",
    label: "PHP",
    ext: "php",
    run: "remote",
    samplePath: "index.php",
    template: `<?php
function main(): void {
}

main();
`,
  },
  {
    id: "ruby",
    label: "Ruby",
    ext: "rb",
    run: "remote",
    samplePath: "main.rb",
    template: `def main
end

main
`,
  },
  {
    id: "html",
    label: "HTML",
    ext: "html",
    run: "preview",
    samplePath: "index.html",
    template: `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8">
    <title></title>
  </head>
  <body></body>
</html>
`,
  },
  {
    id: "css",
    label: "CSS",
    ext: "css",
    run: "none",
    samplePath: "style.css",
    template: `:root {
  color: CanvasText;
}
`,
  },
];

const EXT: Record<string, LangId> = {
  py: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  rb: "ruby",
  html: "html",
  htm: "html",
  css: "css",
  md: "markdown",
  json: "json",
};

export function langFromPath(path: string): LangId {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT[ext] ?? (vscodeExt(ext) as LangId | undefined) ?? "plaintext";
}

export function langMeta(id: LangId): LangMeta | undefined {
  return LANGS.find((l) => l.id === id);
}

export function canRun(path: string): boolean {
  return isExecutablePath(path);
}

export function langLabel(lang: LangId): string {
  return langMeta(lang)?.label ?? (lang === "markdown" ? "Markdown" : lang === "json" ? "JSON" : "Text");
}

export function templateFor(path: string): string {
  const meta = langMeta(langFromPath(path));
  return meta?.template ?? "";
}

export function runnableLangs(): LangMeta[] {
  return LANGS.filter((l) => l.run !== "none");
}
