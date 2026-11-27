import { load, FAILSAFE_SCHEMA } from "js-yaml";
import { redactPatterns } from "./vault-redact.ts";
import { inRuleScope, ruleGlobs, rulePath, rulePathAllowed } from "./rule-scope.ts";

export const RULE_LIMITS = { fileChars: 6000, contextChars: 24000, extraChars: 6000, metadataChars: 4096, descriptionChars: 200, sources: 32, available: 12, candidates: 512, targets: 64, warnings: 12 } as const;
export type RuleDescriptor = { path: string; scope: string; kind: "legacy" | "agents" | "anvil" | "cursor"; description: string; globs: string[] };
export type AppliedRule = RuleDescriptor & { reason: "global" | "ancestor" | "alwaysApply" | "glob" | "manual"; content: string; truncated: boolean };
export type RuleContext = { applied: AppliedRule[]; available: RuleDescriptor[]; targets: string[]; warnings: string[]; truncated: boolean };
type Candidate = RuleDescriptor & { source: string; order: number };
const cut = "\n[gekürzt; vollständige Regeldatei bei Bedarf gezielt lesen]";
const short = (text: string, limit: number) => text.length > limit ? text.slice(0, Math.max(0, limit - cut.length)) + cut : text;
const clean = (text: string) => redactPatterns(text).text.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/g, "[redacted]");
const safeText = (text: string) => [...clean(text)].filter(char => char === "\n" || char === "\t" || char === "\r" || char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join("");

function candidate(path: string, source: string): Candidate | undefined {
  const cursor = /^(?:(.*)\/)?\.cursor\/rules\/(?:[^/]+\/)*[^/]+\.mdc$/i.exec(path);
  if (cursor) return { path, source, scope: cursor[1] || "", kind: "cursor", order: 1, description: "", globs: [] };
  const agents = /^(?:(.*)\/)?agents(?:\.project)?\.md$/i.exec(path);
  if (agents) return { path, source, scope: agents[1] || "", kind: "agents", order: /\.project\.md$/i.test(path) ? 3 : 2, description: "", globs: [] };
  const anvil = /^(?:(.*)\/)?\.anvil\/rules(?:\.md)?$/i.exec(path);
  if (anvil) return { path, source, scope: anvil[1] || "", kind: "anvil", order: /\.md$/i.test(path) ? 5 : 4, description: "", globs: [] };
  if (/^(?:\.cursorrules|CLAUDE\.md)$/i.test(path)) return { path, source, scope: "", kind: "legacy", order: 0, description: "", globs: [] };
}

function cursorRule(item: Candidate) {
  let body = item.source, meta: Record<string, unknown> = {};
  if (/^\uFEFF?---\r?\n/.test(body)) {
    const start = body.indexOf("\n") + 1, end = body.slice(start, RULE_LIMITS.metadataChars + start).search(/^---\s*$/m);
    if (end < 0) throw new Error("Regel-Metadaten fehlen oder überschreiten 4096 Zeichen.");
    const parsed: unknown = load(body.slice(start, start + end), { schema: FAILSAFE_SCHEMA });
    if (parsed !== undefined && (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))) throw new Error("Regel-Metadaten müssen ein Objekt enthalten.");
    meta = (parsed || {}) as Record<string, unknown>;
    body = body.slice(start + end).replace(/^---[^\n]*(?:\n|$)/, "");
  }
  if (meta.alwaysApply !== undefined && meta.alwaysApply !== "true" && meta.alwaysApply !== "false") throw new Error("alwaysApply muss true oder false sein.");
  if (meta.description !== undefined && typeof meta.description !== "string") throw new Error("description muss Text enthalten.");
  const glob = ruleGlobs(meta.globs);
  return { body, always: meta.alwaysApply === "true", description: safeText(String(meta.description || "").slice(0, RULE_LIMITS.metadataChars)).replace(/\s+/g, " ").trim().slice(0, RULE_LIMITS.descriptionChars), ...glob };
}

function rendered(item: AppliedRule): string {
  const scope = item.scope ? item.scope + "/" : "gesamtes Projekt";
  const match = item.globs.length && item.reason === "glob" ? `; Dateimuster: ${item.globs.join(", ")}` : "";
  return `# ${safeText(item.path)}\nGeltungsbereich: ${safeText(scope)}; Auswahl: ${item.reason}${safeText(match)}\n${item.content}`;
}

/** Pure snapshot-based selection. No disk access, scripts, network or activation. */
export function ruleContext(files: Record<string, string>, paths: string[] = []): RuleContext {
  const context: RuleContext = { applied: [], available: [], targets: [], warnings: [], truncated: false };
  const warn = (message: string) => { if (!context.warnings.includes(message) && context.warnings.length < RULE_LIMITS.warnings) context.warnings.push(message); };
  const normalized: Array<[string, string]> = [], variants = new Map<string, Set<string>>(), counts = new Map<string, number>();
  for (const [raw, source] of Object.entries(files)) {
    const path = rulePath(raw);
    if (!path) { if (/(?:agents|rules)/i.test(raw)) warn("Ungültiger oder mehrdeutiger Regelpfad ausgelassen."); continue; }
    if (!rulePathAllowed(path) || typeof source !== "string") continue;
    normalized.push([path, source]);
    counts.set(path.toLowerCase(), (counts.get(path.toLowerCase()) || 0) + 1);
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join("/"), key = prefix.toLowerCase();
      const spellings = variants.get(key) || new Set<string>();
      spellings.add(prefix); variants.set(key, spellings);
    }
  }
  const ambiguous = (path: string) => path.split("/").some((_, i, parts) => {
    const key = parts.slice(0, i + 1).join("/").toLowerCase();
    return (variants.get(key)?.size || 0) > 1 || (counts.get(key) || 0) > 1 || (i < parts.length - 1 && counts.has(key));
  });
  for (const raw of paths.slice(0, RULE_LIMITS.targets)) {
    const path = rulePath(typeof raw === "string" ? raw.replace(/[\\/]$/, "") : raw);
    if (!path || !rulePathAllowed(path) || ambiguous(path)) { warn("Unsicherer, ausgeschlossener oder mehrdeutiger Zielpfad ausgelassen."); continue; }
    if (!context.targets.some(value => value.toLowerCase() === path.toLowerCase())) context.targets.push(path);
  }
  if (paths.length > RULE_LIMITS.targets) { context.truncated = true; warn("Zielpfade auf 64 begrenzt."); }
  const candidates = normalized.map(([path, source]) => candidate(path, source)).filter((item): item is Candidate => Boolean(item))
    .sort((a, b) => (a.scope ? a.scope.split("/").length : 0) - (b.scope ? b.scope.split("/").length : 0) || a.scope.toLowerCase().localeCompare(b.scope.toLowerCase()) || a.order - b.order || a.path.toLowerCase().localeCompare(b.path.toLowerCase()));
  let length = 0;
  for (const item of candidates.slice(0, RULE_LIMITS.candidates)) {
    if (ambiguous(item.path)) { warn("Mehrdeutige Groß-/Kleinschreibung oder Datei-/Ordnerkollision: betroffene Regeln ausgelassen."); continue; }
    if (item.scope && !context.targets.some(path => inRuleScope(path, item.scope))) continue;
    let content = item.source, reason: AppliedRule["reason"] = item.scope ? "ancestor" : "global";
    if (item.kind === "cursor") {
      try {
        const parsed = cursorRule(item);
        content = parsed.body; item.description = parsed.description; item.globs = parsed.globs;
        const explicit = context.targets.some(path => path.toLowerCase() === item.path.toLowerCase());
        const matches = context.targets.some(path => inRuleScope(path, item.scope) && parsed.matches(item.scope ? path.slice(item.scope.length + 1) : path));
        if (explicit) reason = "manual";
        else if (parsed.always) reason = "alwaysApply";
        else if (matches) reason = "glob";
        else {
          if (context.available.length < RULE_LIMITS.available) context.available.push({ path: item.path, scope: item.scope, kind: item.kind, description: item.description, globs: item.globs });
          else { context.truncated = true; warn("Verfügbare Regelbeschreibungen auf 12 begrenzt."); }
          continue;
        }
      } catch { warn(`Ungültige Metadaten in ${safeText(item.path)}; Regel ausgelassen.`); continue; }
    }
    if (!content.trim()) continue;
    if (context.applied.length >= RULE_LIMITS.sources) { context.truncated = true; warn("Angewendete Regeln auf 32 begrenzt."); continue; }
    const raw = content.trim(), bounded = safeText(raw.slice(0, RULE_LIMITS.fileChars + 4096));
    const rule: AppliedRule = { path: item.path, scope: item.scope, kind: item.kind, description: item.description, globs: item.globs, reason, content: short(bounded, RULE_LIMITS.fileChars), truncated: raw.length > RULE_LIMITS.fileChars };
    if (length + rendered(rule).length > RULE_LIMITS.contextChars) {
      const room = RULE_LIMITS.contextChars - length - (rendered({ ...rule, content: "" }).length + 2);
      if (room < cut.length + 32) { context.truncated = true; warn("Regelkontext auf 24000 Zeichen begrenzt."); continue; }
      rule.content = short(rule.content, room); rule.truncated = true;
    }
    length += rendered(rule).length + 2;
    context.applied.push(rule); context.truncated ||= rule.truncated;
  }
  if (candidates.length > RULE_LIMITS.candidates) { context.truncated = true; warn("Regelkandidaten auf 512 begrenzt."); }
  return context;
}

export function workspaceRules(files: Record<string, string>, extra = "", paths: string[] = []): string {
  const context = ruleContext(files, paths), chunks = context.applied.map(rendered);
  if (extra.trim()) chunks.push(`# Zusätzliche Nutzerregeln\n${short(safeText(extra.trim().slice(0, RULE_LIMITS.extraChars + 4096)), RULE_LIMITS.extraChars)}`);
  return chunks.join("\n\n");
}

export function ruleFilesPresent(files: Record<string, string>, paths: string[] = []): string[] {
  return ruleContext(files, paths).applied.map(item => item.path);
}
