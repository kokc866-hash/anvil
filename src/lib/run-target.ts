/** Shared by the Run button, keyboard shortcuts and agent tool dispatch. */
import { projectHtmlEntry } from "./canvas/project.ts";

const EXECUTABLE = /\.(cpp|cc|cxx|c|py|js|jsx|mjs|cjs|ts|tsx|go|rs|java|cs|php|rb|html|htm)$/i;
const PREFERRED = ["index.html", "main.cpp", "main.c", "main.py", "main.js", "main.ts", "main.go", "src/main.rs", "Main.java", "Program.cs"];

export function isExecutablePath(path: string): boolean {
  const p = path.replace(/\\/g, "/").replace(/^\.\//, "");
  return EXECUTABLE.test(p) && !/\.d\.ts$/i.test(p) && !/(^|\/)(\.anvil|\.git|node_modules|ref)\//i.test(p);
}

export function selectRunTarget(files: Iterable<string>, hint = "", contents?: Record<string, string>): string {
  const paths = [...files].map((p) => p.replace(/\\/g, "/")).filter(isExecutablePath);
  const active = hint.replace(/\\/g, "/");
  // A browser script is an input of its HTML entry, not a standalone Node
  // program. Resolve actual local script links, never just a filename mention.
  // Explicit test files retain their own execution semantics.
  if (contents && /\.(?:[cm]?js|jsx|ts|tsx)$/i.test(active)
    && !/(^|\/)(?:tests?|specs?)(\/|$)|[._](?:test|spec)\.[^/]+$/i.test(active)) {
    const html = projectHtmlEntry(active, contents);
    if (html && paths.includes(html)) return html;
  }
  if (paths.includes(active)) return active;
  const folder = active.includes("/") ? active.slice(0, active.lastIndexOf("/") + 1) : "";
  const siblings = folder ? paths.filter((p) => p.startsWith(folder)) : paths;
  const candidates = siblings.length ? siblings : paths;
  for (const name of PREFERRED) {
    const match = candidates.find((p) => p === name || p.endsWith("/" + name));
    if (match) return match;
  }
  return candidates.find((p) => !/(^|\/)(tests?|specs?)\/|[._](test|spec)\./i.test(p)) ?? candidates[0] ?? "";
}
