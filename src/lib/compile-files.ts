import { decodeWriteEscapes } from "./agent-parse.ts";

const EXT_LANG: Record<string, string> = {
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  h: "c",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  cs: "csharp",
  php: "php",
  rb: "ruby",
  py: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
};

function langOf(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? "";
}

const MANIFEST: Record<string, RegExp> = {
  go: /(^|\/)go\.(mod|sum)$/i,
  rust: /(^|\/)Cargo\.(toml|lock)$/i,
  c: /(^|\/)(CMakeLists\.txt|Makefile|makefile)$/i,
  cpp: /(^|\/)(CMakeLists\.txt|Makefile|makefile)$/i,
  csharp: /\.(csproj|sln)$/i,
  java: /(^|\/)(pom\.xml|build\.gradle)$/i,
};

export function compileFiles(
  lang: string,
  entry: string,
  files: Record<string, string>,
): { path: string; content: string }[] {
  const man = MANIFEST[lang];
  return Object.entries(files)
    .sort(([a], [b]) => a === entry ? -1 : b === entry ? 1 : 0)
    .filter(([p]) => {
      if (p === entry) return true;
      if (/(^|\/)(\.anvil|\.git|node_modules|ref)\//i.test(p)) return false;
      if (man?.test(p)) return true;
      const l = langOf(p);
      if (lang === "c" || lang === "cpp") return l === "c" || l === "cpp";
      return l === lang;
    })
    .map(([path, content]) => ({ path, content: decodeWriteEscapes(content) }));
}
