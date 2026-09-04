/** Reine Parser/Heuristiken — ohne Store, testbar unter node --test. */

export type LearnKind = "user" | "project" | "lesson";
export type SkillKind = "guide" | "plugin";
export type LearnScope = "user" | "project";

export function idFromPins(s: { githubRepo?: string; workspaceCwd?: string; diskName?: string }): string {
  const repo = String(s.githubRepo || "").trim();
  if (repo) return repo.slice(0, 80);
  const cwd = String(s.workspaceCwd || "")
    .replaceAll("\\", "/")
    .replace(/\/+$/, "")
    .trim();
  if (cwd) {
    const parts = cwd.split("/").filter(Boolean);
    const tail = parts.slice(-3).join("/");
    return (tail || cwd).slice(0, 80);
  }
  const disk = String(s.diskName || "").trim();
  if (disk) return disk.slice(0, 80);
  return "local";
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
  const kein = text.match(/\bkein(?:e|en|er)?\s+([a-zA-Zäöü][\w.+-]{1,40})/i);
  if (kein && !STOP_WORD.test(kein[1]) && kein[1].length > 2) {
    out.push({ kind: "lesson", text: `Nicht verwenden: ${kein[1].trim()}`, conf: 0.76 });
  }
  if (/\bpytest\b/.test(t)) out.push({ kind: "project", text: "Python-Tests mit pytest.", conf: 0.78 });
  if (/\b(knapp|kurz|ohne essay|ohne blabla)\b/.test(t)) out.push({ kind: "user", text: "Antworten kurz halten.", conf: 0.84 });
  if (/\btypescript\b/.test(t) && /\blieber|immer|statt\b/.test(t)) out.push({ kind: "user", text: "Bevorzugt TypeScript.", conf: 0.7 });
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
  let scope: LearnScope = "user";
  if (fm) {
    const head = fm[1];
    body = fm[2].trim();
    name = head.match(/^name:\s*(.+)$/m)?.[1]?.trim() || name;
    when = head.match(/^when:\s*(.+)$/m)?.[1]?.trim() || "";
    if (head.match(/^kind:\s*plugin\s*$/mi)) kind = "plugin";
    if (head.match(/^scope:\s*project\s*$/mi)) scope = "project";
  }
  if (!name || body.length < 8) return null;
  const id = slugSkillId(name) || slugSkillId(base) || "skill";
  return { id, name, when: when || name, body, kind, scope };
}
