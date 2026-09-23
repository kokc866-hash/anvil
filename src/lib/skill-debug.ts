export type SkillDraft = { name: string; when: string; body: string; fails?: number };
import {debugKnowledgeSkill} from '../../electron/knowledge-skill-check.mjs';

export function debugSkill(s: SkillDraft): { ok: boolean; issues: string[] } {
  return debugKnowledgeSkill(s);
}

export const SKILL_CREATOR_BODY = `1. skill_list, bei Namen skill_read.
2. Ziel in einem Satz. Name kebab-case, when = Trigger-Wörter.
3. body nur nummerierte Schritte mit echten Tools (read_file, edit_file, append_file, run_file, grep, shell). Keine Prosa.
4. skill_write. Dann skill_debug.
5. Issues → skill_write erneut mit korrigiertem body.
6. Einmal skill_run auf dem neuen Skill. Bei Fehler skill_outcome fail und body patchen.
7. Fertig: skill_outcome ok.`;
