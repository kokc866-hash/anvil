const TOOLS = /read_file|write_file|append_file|edit_file|run_file|grep|shell|list_files|git_|engine_|mcp_|skill_|format_file|open_preview|see_run/;

export type SkillDraft = { name: string; when: string; body: string; fails?: number };

export function debugSkill(s: SkillDraft): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const name = s.name.trim();
  const when = s.when.trim();
  const body = s.body.trim();
  if (name.length < 3) issues.push("Name zu kurz");
  if (/\s/.test(name)) issues.push("Name ohne Leerzeichen (kebab-case)");
  if (when.split(/\s+/).filter((w) => w.length > 2).length < 2) issues.push("when braucht mehrere Trigger-Wörter");
  if (body.length < 40) issues.push("body zu kurz — nummerierte Tool-Schritte");
  if (body.length > 8000) issues.push("body zu lang (max 8000)");
  if (!/^\s*\d+[.)]/m.test(body) && (body.match(/\n/g) || []).length < 2) {
    issues.push("body als nummerierte Schritte (1. 2. 3.)");
  }
  if (!TOOLS.test(body)) issues.push("kein Anvil-Tool im body (read_file, edit_file, run_file, …)");
  if ((s.fails ?? 0) >= 3) issues.push("mehrfach fehlgeschlagen — Schritte prüfen, nicht blind wiederholen");
  return { ok: issues.length === 0, issues };
}

export const SKILL_CREATOR_BODY = `1. skill_list, bei Namen skill_read.
2. Ziel in einem Satz. Name kebab-case, when = Trigger-Wörter.
3. body nur nummerierte Schritte mit echten Tools (read_file, edit_file, append_file, run_file, grep, shell). Keine Prosa.
4. skill_write. Dann skill_debug.
5. Issues → skill_write erneut mit korrigiertem body.
6. Einmal skill_run auf dem neuen Skill. Bei Fehler skill_outcome fail und body patchen.
7. Fertig: skill_outcome ok.`;
