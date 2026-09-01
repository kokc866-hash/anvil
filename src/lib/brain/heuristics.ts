import { useIde } from "@/store/ide";
import { useLearn } from "@/lib/learn";

export type HeurIntent = { kind: string; path?: string; query?: string; conf: number };

export function heuristicCommit(paths: string[]) {
  const n = paths.length;
  if (n === 0) return "chore";
  if (n === 1) return `update ${paths[0]}`;
  return `update ${n} files`;
}

export function heuristicError(stderr: string, path: string): string {
  const last = stderr.trim().split("\n").filter(Boolean).at(-1) ?? "";
  const named = stderr.match(/(SyntaxError|NameError|TypeError|ReferenceError|ModuleNotFoundError|Cannot find module)[:\s]+([^\n]+)/i);
  if (named) return `${named[1]}: ${named[2].slice(0, 100)}`;
  const loc = stderr.match(/(\S+\.\w+):(\d+)/);
  if (loc) return `${loc[1]}:${loc[2]}`;
  return last.slice(0, 120);
}

export function heuristicSearch(q: string): string {
  const quoted = q.match(/"([^"]{2,40})"/);
  if (quoted) return quoted[1];
  return q.trim();
}

export function heuristicAttach(ask: string, files: string[]): string[] {
  const t = ask.toLowerCase();
  const out: string[] = [];
  for (const p of files) {
    const b = (p.split("/").pop() ?? p).replace(/\.\w+$/, "").toLowerCase();
    if (b.length < 3) continue;
    const re = new RegExp(`(?:^|\\W)${escapeRe(b)}(?:\\W|$)`, "i");
    if (re.test(t) || t.includes(p.toLowerCase())) out.push(p);
  }
  if (/\b(diese datei|aktuell(e datei)?|this file)\b/i.test(ask)) {
    const a = useIde.getState().activePath;
    if (a && files.includes(a)) out.push(a);
  }
  return [...new Set(out)].slice(0, 4);
}

export function heuristicPalette(q: string, labels: string[]): string | null {
  const n = q.trim().toLowerCase();
  if (n.length < 2) return null;
  const exact = labels.find((l) => l.toLowerCase() === n);
  if (exact) return exact;
  const start = labels.filter((l) => l.toLowerCase().startsWith(n));
  return start.length === 1 ? start[0] : null;
}

export function heuristicTitle(user: string): string {
  const t = user.replace(/\s+/g, " ").trim();
  return t.slice(0, 42).replace(/[.?!,:;]+$/, "");
}

export function heuristicUsageFacts(): { kind: "user" | "project"; text: string }[] {
  const ev = useLearn.getState().events.slice(0, 40);
  if (ev.length < 12) return [];
  const count: Record<string, number> = {};
  for (const e of ev) count[e.k] = (count[e.k] ?? 0) + 1;
  const out: { kind: "user" | "project"; text: string }[] = [];
  if ((count.run ?? 0) >= 8) out.push({ kind: "user", text: "Führt oft aus, prüft schnell." });
  if ((count.debug ?? 0) >= 6) out.push({ kind: "user", text: "Nutzt den Debugger regelmäßig." });
  if ((count.reject ?? 0) >= 4) out.push({ kind: "user", text: "Verwirft Agent-Diffs oft — vorsichtiger vorschlagen." });
  return out.slice(0, 1);
}

export function expandIntent(text: string): HeurIntent | null {
  const t = text.trim().toLowerCase().replace(/[!?]+$/, "");
  if (t.split(/\s+/).length > 4) return null;
  if (/^(commit|commiten)$/.test(t)) return { kind: "git", conf: 0.92 };
  if (/^(theme|dunkel|hell|dark|light)$/.test(t)) return { kind: "settings", conf: 0.9 };
  const files = Object.keys(useIde.getState().files);
  if (/^[A-Za-z0-9._/-]+\.\w{1,8}$/.test(text.trim())) {
    const token = text.trim();
    const hit = files.find((p) => p === token || p.endsWith("/" + token) || p.endsWith(token));
    if (hit) return { kind: "file", path: hit, conf: 0.95 };
  }
  return null;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export {
  heuristicTabHint,
  heuristicStopNote,
  heuristicLogTrim,
  heuristicI18nKey,
  heuristicMention,
  heuristicComment,
  leftoverSecretHints,
} from "./extra-heur";
