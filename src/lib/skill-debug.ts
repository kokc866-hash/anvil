export type SkillDraft = { name: string; when: string; body: string; fails?: number; resources?: string[]; baseDirectory?: string };
export type SkillCheckOptions = { resources?: string[] | Record<string, string>; baseDirectory?: string; files?: Record<string, string>; knownTools?: string[] };
import {debugKnowledgeSkill} from '../../electron/knowledge-skill-check.mjs';

export function debugSkill(s: SkillDraft, options: SkillCheckOptions = {}) {
  return debugKnowledgeSkill(s, options);
}

export const SKILL_CREATOR_BODY = `Prüfe mit skill_list und skill_read, ob eine passende Arbeitsweise schon vorhanden ist.
Beschreibe Zweck und Anwendungsbereich konkret. Eine verständliche Anleitung darf Prosa und gezielte Beispiele enthalten.
Verwende echte freigegebene Anvil-Werkzeuge; Dienstwerkzeuge zuerst im aktuellen MCP-Katalog prüfen.
Speichere einen beauftragten eigenen Skill mit skill_write oder verbessere ihn mit skill_patch. Projektbezogen speichern, außer der Nutzer beauftragt ausdrücklich einen allgemeinen Skill.
Mit skill_debug Format, Referenzen und bekannte Werkzeuge prüfen. Diese Prüfung bestätigt kein erfolgreiches Verhalten.
Erprobe einen passenden Fall, einen ähnlichen unpassenden Auftrag und fehlende Voraussetzungen nur im erlaubten Testumfang. Eine Modellrückmeldung über skill_outcome ist keine unabhängige Funktionsprüfung.`;
