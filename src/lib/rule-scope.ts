import { isSecretPath } from "./ref.ts";
import { redactPatterns } from "./vault-redact.ts";

/** Relative Windows-safe workspace paths only. Never resolve traversal for rules. */
export function rulePath(raw: string): string | undefined {
  if (typeof raw !== "string" || !raw || raw.length > 1024 || /%[0-9a-f]{2}/i.test(raw)) return;
  const path = raw.replaceAll("\\", "/");
  if (redactPatterns(path).n) return;
  if (path.split("/").some(part => !part || part.length > 255 || part === "." || part === ".."
    || /[<>:"|?*]/.test(part) || /[. ]$/.test(part)
    || [...part].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    || /[\u202a-\u202e\u2066-\u2069]/.test(part)
    || /^(?:__proto__|prototype|constructor)$/i.test(part)
    || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) return;
  return path;
}

export function rulePathAllowed(path: string): boolean {
  // Installed plugin contents remain guides. Their import record is never a
  // permission source for workspace rules, hooks or arbitrary scripts.
  return !isSecretPath(path) && !/(?:^|\/)(?:\.git|\.ssh|node_modules|secrets?|vault|credentials)(?:\/|$)/i.test(path)
    && !/(?:^|\/)\.anvil\/(?:skills|plugin-imports)(?:\/|$)/i.test(path);
}

export const inRuleScope = (target: string, scope: string) => !scope || target.toLowerCase() === scope.toLowerCase()
  || target.toLowerCase().startsWith(scope.toLowerCase() + "/");

/** Split commas outside braces so extension alternatives remain one glob. */
function splitGlobs(source: string): string[] {
  const parts: string[] = [];
  let start = 0, brace = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "{") brace++;
    if (source[i] === "}") brace--;
    if (brace < 0 || brace > 1) throw new Error("Verschachtelte oder ungepaarte Glob-Klammern werden nicht unterstützt.");
    if (source[i] === "," && !brace) { parts.push(source.slice(start, i).trim()); start = i + 1; }
  }
  if (brace) throw new Error("Ungepaarte Glob-Klammern werden nicht unterstützt.");
  parts.push(source.slice(start).trim());
  return parts.filter(Boolean);
}

function expandGlob(pattern: string): string[] {
  let expanded = [pattern];
  while (expanded.some(item => /\{/.test(item))) {
    const next: string[] = [];
    for (const item of expanded) {
      const match = /\{([^{}]+)\}/.exec(item);
      if (!match) { next.push(item); continue; }
      const choices = match[1].split(",");
      if (!choices.length || choices.length > 16 || choices.some(choice => !choice)) throw new Error("Zu viele oder leere Glob-Alternativen.");
      for (const choice of choices) {
        next.push(item.slice(0, match.index) + choice + item.slice(match.index + match[0].length));
        if (next.length > 32) throw new Error("Zu viele Glob-Alternativen.");
      }
    }
    expanded = next;
  }
  return expanded;
}

function segmentMatches(pattern: string, value: string): boolean {
  let p = 0, v = 0, star = -1, after = 0;
  while (v < value.length) {
    if (pattern[p] === "?" || pattern[p] === value[v]) { p++; v++; }
    else if (pattern[p] === "*") { star = p++; after = v; }
    else if (star >= 0) { p = star + 1; v = ++after; }
    else return false;
  }
  while (pattern[p] === "*") p++;
  return p === pattern.length;
}

/** Bounded wildcard matching avoids executing project-supplied regexes. */
function globMatches(pattern: string, path: string): boolean {
  const patterns = pattern.toLowerCase().split("/"), parts = path.toLowerCase().split("/");
  if (patterns.length === 1) return segmentMatches(patterns[0], parts.at(-1) || "");
  const memo = new Map<string, boolean>();
  const match = (p: number, v: number): boolean => {
    const key = `${p}:${v}`, known = memo.get(key);
    if (known !== undefined) return known;
    const result = p === patterns.length ? v === parts.length : patterns[p] === "**"
      ? match(p + 1, v) || v < parts.length && match(p, v + 1)
      : v < parts.length && segmentMatches(patterns[p], parts[v]) && match(p + 1, v + 1);
    memo.set(key, result); return result;
  };
  return match(0, 0);
}

export function ruleGlobs(value: unknown): { globs: string[]; matches: (path: string) => boolean } {
  const values = value === undefined || value === "" ? [] : typeof value === "string" ? [value] : value;
  if (!Array.isArray(values) || values.length > 16 || values.some(item => typeof item !== "string")) throw new Error("globs muss Text oder eine Liste mit höchstens 16 Mustern enthalten.");
  const globs = values.flatMap(item => splitGlobs(item as string));
  if (globs.length > 16) throw new Error("Höchstens 16 Glob-Muster sind erlaubt.");
  const include: string[] = [], exclude: string[] = [];
  for (const raw of globs) {
    if (redactPatterns(raw).n) throw new Error("Zugangsdaten gehören nicht in Dateimuster.");
    const negative = raw.startsWith("!"), pattern = (negative ? raw.slice(1) : raw).replace(/^\.\//, "");
    if (!pattern || pattern.length > 256 || pattern.startsWith("/") || /[\\:<>|[\]()%]/.test(pattern) || [...pattern].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      || pattern.split("/").some(part => !part || part === "." || part === "..") || /[{}]/.test(pattern.replace(/\{[^{}]+\}/g, ""))) throw new Error("Ungültiges oder nicht unterstütztes Glob-Muster.");
    const expanded = expandGlob(pattern);
    if (expanded.some(item => item.split("/").length > 32 || item.split("/").some(part => part === "." || part === ".." || part.includes("**") && part !== "**"))) throw new Error("Ungültige Glob-Alternativen oder zu viele Pfadsegmente.");
    if (include.length + exclude.length + expanded.length > 64) throw new Error("Zu viele aufgelöste Glob-Muster.");
    (negative ? exclude : include).push(...expanded);
  }
  return { globs, matches: path => include.some(pattern => globMatches(pattern, path)) && !exclude.some(pattern => globMatches(pattern, path)) };
}
