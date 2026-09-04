import { skipPath } from "./ws-skip.ts";
import { isSecretPath } from "./ref.ts";

export type SearchOpts = {
  regex?: boolean;
  case?: boolean;
  word?: boolean;
};

export type SearchHit = {
  path: string;
  line: number;
  col: number;
  end: number;
  text: string;
  match: string;
};

export function skipSearchPath(path: string): boolean {
  return skipPath(path) || isSecretPath(path) || /\.(png|jpe?g|gif|webp|ico|bmp)$/i.test(path);
}


export function compileSearch(needle: string, opts: SearchOpts): RegExp | null {
  const n = needle.trim();
  if (!n) return null;
  const flags = `${opts.case ? "" : "i"}g`;
  try {
    if (opts.regex) return new RegExp(opts.word ? `\\b(?:${n})\\b` : n, flags);
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(opts.word ? `\\b${esc}\\b` : esc, flags);
  } catch {
    return null;
  }
}

export function findInFiles(
  files: Record<string, string>,
  needle: string,
  opts: SearchOpts = {},
  limit = 200,
): SearchHit[] {
  const re = compileSearch(needle, opts);
  if (!re) return [];
  const out: SearchHit[] = [];
  for (const path of Object.keys(files).sort()) {
    if (skipSearchPath(path)) continue;
    const src = files[path];
    if (!src || src.length > 400_000 || src.startsWith("data:image/")) continue;
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i];
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        if (!m[0]) {
          re.lastIndex += 1;
          continue;
        }
        out.push({
          path,
          line: i + 1,
          col: m.index + 1,
          end: m.index + m[0].length + 1,
          text: text.slice(0, 240),
          match: m[0],
        });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

export function afterLine(hit: SearchHit, needle: string, repl: string, opts: SearchOpts): string {
  const i = Math.max(0, hit.col - 1);
  const j = Math.max(i, hit.end - 1);
  if (!opts.regex) return hit.text.slice(0, i) + repl + hit.text.slice(j);
  const re = compileSearch(needle, { ...opts, word: opts.word });
  if (!re) return hit.text.slice(0, i) + repl + hit.text.slice(j);
  const one = new RegExp(re.source, re.flags.replace("g", ""));
  return hit.text.slice(0, i) + hit.match.replace(one, repl) + hit.text.slice(j);
}

export function applyHits(
  files: Record<string, string>,
  hits: SearchHit[],
  needle: string,
  repl: string,
  opts: SearchOpts,
): Record<string, string> {
  const re = compileSearch(needle, opts);
  if (!re) return {};
  const wanted = new Map<string, Set<string>>();
  for (const h of hits) {
    const set = wanted.get(h.path) ?? new Set<string>();
    set.add(`${h.line}:${h.col}`);
    wanted.set(h.path, set);
  }
  const one = new RegExp(re.source, re.flags.replace("g", ""));
  const out: Record<string, string> = {};
  for (const [path, keys] of wanted) {
    const lines = (files[path] ?? "").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const src = lines[i];
      re.lastIndex = 0;
      let next = "";
      let last = 0;
      let changed = false;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        if (!m[0]) {
          re.lastIndex += 1;
          continue;
        }
        next += src.slice(last, m.index);
        if (keys.has(`${i + 1}:${m.index + 1}`)) {
          next += opts.regex ? m[0].replace(one, repl) : repl;
          changed = true;
        } else next += m[0];
        last = m.index + m[0].length;
      }
      if (changed) lines[i] = next + src.slice(last);
    }
    const joined = lines.join("\n");
    if (joined !== files[path]) out[path] = joined;
  }
  return out;
}
