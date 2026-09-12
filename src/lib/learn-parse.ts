/** Reine Parser/Heuristiken — ohne Store, testbar unter node --test. */

export type LearnKind = "user" | "project" | "lesson";
export type SkillKind = "guide" | "plugin";
export type LearnScope = "user" | "project";

export function idFromPins(s: { githubRepo?: string; workspaceCwd?: string; diskName?: string; workspaceMemoryId?: string }): string {
  let cwd = String(s.workspaceCwd || "").trim().replaceAll("\\", "/");
  if (cwd.length > 1 && !/^[a-z]:\/$/i.test(cwd)) cwd = cwd.replace(/\/+$/, "");
  if (cwd) {
    // Windows drive/UNC paths are case insensitive. Keep complete paths, not tails.
    if (/^[a-z]:\//i.test(cwd) || cwd.startsWith("//")) cwd = cwd.toLowerCase();
    return `v2:path:${cwd}`;
  }
  const repo = String(s.githubRepo || "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\/+$/, "").replace(/\.git$/i, "").toLowerCase();
  if (repo) return `v2:repo:${repo}`;
  return `v2:local:${s.workspaceMemoryId || "unassigned"}`;
}

export function legacyProject(ws?: string): boolean { return !ws?.startsWith("v2:"); }

export function memoryWords(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9äöüß]+/).filter(w => w.length > 2 && !/^(der|die|das|und|oder|mit|für|bitte|eine|einen|the|and|with|this|that|was|wie)$/.test(w)))];
}

export function projectish(text: string) {
  return /\b(test|pytest|src\/|package\.json|anvil\.run|cargo|go\.mod|pom\.xml|jest|vitest)\b/i.test(text);
}

export function slugSkillId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const STOP_WORD =
  /^(ahnung|problem|bock|sinn|plan|stress|ding|mensch|witz|spaß|spass|thema|idee|zeit|mal|fehler|der|die|das|ein|eine|und|oder|auch|noch|wieder|so|es|nicht|was|wie|warum)$/i;

export function factsFromUtterance(text: string): { kind: LearnKind; text: string; conf: number }[] {
  const t = text.toLowerCase();
  if (text.trim().endsWith("?")) return [];
  const out: { kind: LearnKind; text: string; conf: number }[] = [];
  const immer = text.match(/\bimmer\s+(.{4,90}?)(?:\.|$|\n)/i);
  if (immer) {
    const bit = immer[1].trim();
    const first = bit.split(/\s+/)[0] ?? "";
    if (bit.length >= 4 && !STOP_WORD.test(first)) {
      out.push({ kind: projectish(bit) ? "project" : "user", text: `Immer: ${bit}`, conf: 0.82 });
    }
  }
  const lieber = text.match(/\blieber\s+(.{4,90}?)(?:\.|$|\n)/i);
  if (lieber) {
    const bit = lieber[1].trim();
    if (bit.length >= 4 && !STOP_WORD.test(bit.split(/\s+/)[0] ?? "")) {
      out.push({ kind: "user", text: `Lieber: ${bit}`, conf: 0.8 });
    }
  }
  // Questions and descriptions of missing features are not prohibitions.
  const ban = text.match(/(?:^|[.!]\s*|\bbitte\s+)(?:kein(?:e|en|er)?\s+)([a-zA-Zäöü][\w.+-]{1,40})/i)
    || text.match(/\b([a-zA-Zäöü][\w.+-]{1,40})\s+nicht\s+(?:verwenden|benutzen|nutzen)\b/i);
  if (ban && !text.trim().endsWith("?") && !STOP_WORD.test(ban[1]) && ban[1].length > 2) {
    out.push({ kind: projectish(ban[1]) ? "project" : "lesson", text: `Nicht verwenden: ${ban[1].trim()}`, conf: 0.76 });
  }
  if (/\bpytest\b/.test(t) && !/\b(?:kein\w*|nicht|statt|ohne)\b/.test(t) && /\b(?:immer|nutze[n]?|verwende[n]?|wir nutzen|mit pytest)\b/.test(t)) {
    out.push({ kind: "project", text: "Python-Tests mit pytest.", conf: 0.78 });
  }
  if (!/\b(?:nicht|kein\w*)\s+(?:so\s+)?(?:kurz|knapp)\b/.test(t) && /(?:^(?:kurz|knapp)[.! ]*$|\b(?:bitte|antwort\w*)\s+(?:kurz|knapp)|\b(?:kurz|knapp)\s+antwort|ohne essay|ohne blabla)/.test(t)) out.push({ kind: "user", text: "Antworten kurz halten.", conf: 0.84 });
  if (/\b(?:lieber|immer)\s+typescript\b/.test(t) && !/\b(?:nicht|kein\w*)\s+(?:lieber |immer )?typescript\b/.test(t)) out.push({ kind: "user", text: "Bevorzugt TypeScript.", conf: 0.7 });
  return out;
}

export function parseSkillMd(
  src: string,
  path = "",
): {
  id: string;
  name: string;
  when: string;
  body: string;
  kind: SkillKind;
  scope: LearnScope;
} | null {
  const base = path.replace(/^.*[/\\]/, "").replace(/\.md$/i, "");
  const fm = String(src).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  let name = base;
  let when = "";
  let body = String(src).trim();
  let kind: SkillKind = "guide";
  let scope: LearnScope = "project";
  if (fm) {
    const head = fm[1];
    body = fm[2].trim();
    name = head.match(/^name:\s*(.+)$/m)?.[1]?.trim() || name;
    when = head.match(/^when:\s*(.+)$/m)?.[1]?.trim() || "";
    if (head.match(/^kind:\s*plugin\s*$/mi)) kind = "plugin";
    if (head.match(/^scope:\s*user\s*$/mi)) scope = "user";
  }
  if (!name || body.length < 8) return null;
  const id = slugSkillId(base) || slugSkillId(name) || "skill";
  return { id, name, when: when || name, body: body.slice(0, 8000), kind, scope };
}
