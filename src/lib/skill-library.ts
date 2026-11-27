import { ANVIL_SKILLS } from './anvil-skills.generated.ts';
import { routeTaskSkills } from './skill-routing.ts';
export { SKILL_PRESELECT_LIMIT } from './skill-routing.ts';

export type SkillRequirement = { kind: 'project' | 'engine' | 'service' | 'execution'; label: string; labelEn: string; match?: string };
export type AnvilSkill = { id: string; title: string; titleEn: string; description: string; category: string; categoryLabel: string; categoryLabelEn: string; keywords: string[]; requirements: SkillRequirement[]; tools?: string[]; readOnly: boolean; version: string; compatibility?: string; metadata?: Record<string, string>; body: string; source: string; resources: Record<string, string> };
export type SkillFeedback = { id: string; jobId: string; version: string; kind: 'ok' | 'fail' | 'reject' | 'undo'; at: number; source: 'agent' };
export type SkillRecord = { id: string; name: string; when: string; body: string; builtin?: boolean; file?: string; scope?: string; uses?: number; wins?: number; fails?: number; score?: number; feedback?: SkillFeedback[] };
export type SkillEnvironment = { project: boolean; saved?: boolean; engines: string[]; frameworks?: string[]; execution: boolean; services: { name: string; enabled: boolean; catalog: boolean; tools: boolean }[] };
export type RequirementStatus = SkillRequirement & { status: 'ready' | 'missing' | 'unknown'; detail: string; detailEn: string };
export type SkillSelection = { id: string; name: string; reason: string; reasonEn: string; requirements: RequirementStatus[]; explicit: boolean; loaded?: boolean };
export const builtinSkill = (id: string) => ANVIL_SKILLS.find(skill => skill.id === id);
export { ANVIL_SKILLS };

export function librarySeeds() {
  return ANVIL_SKILLS.map(skill => ({ id: skill.id, name: skill.id, when: skill.description, body: skill.body, builtin: true, kind: 'guide' as const, uses: 0, at: 0, score: .8, wins: 0, fails: 0, scope: 'user' as const }));
}

/** Keep user/imported skills intact; refresh only the canonical bundled instructions. */
export function mergeSkillLibrary<T extends SkillRecord>(existing: T[]) {
  const ids = new Set(existing.map(skill => skill.id));
  const custom = existing.filter(skill => !builtinSkill(skill.id) || !skill.builtin).map(skill => {
    if (!builtinSkill(skill.id)) return skill;
    let id = `${skill.id}-custom`, count = 2;
    while (ids.has(id)) id = `${skill.id}-custom-${count++}`;
    ids.add(id);
    return { ...skill, id };
  });
  return [...librarySeeds().map(seed => {
    const previous = existing.find(skill => skill.id === seed.id && skill.builtin);
    return { ...seed, uses: previous?.uses ?? 0, wins: previous?.wins ?? 0, fails: previous?.fails ?? 0, score: previous?.score ?? seed.score, ...(previous?.feedback ? { feedback: previous.feedback } : {}) };
  }), ...custom];
}

export function skillRequirements(id: string, env: SkillEnvironment): RequirementStatus[] {
  return (builtinSkill(id)?.requirements || []).map(requirement => {
    let status: RequirementStatus['status'] = 'ready', detail = '', detailEn = '';
    if (requirement.kind === 'project') {
      status = env.project && (requirement.match !== 'saved' || env.saved) ? 'ready' : 'missing'; detail = requirement.match === 'saved' ? 'Projektordner muss geöffnet und gespeichert sein.' : 'Projektdateien müssen geöffnet sein.'; detailEn = requirement.match === 'saved' ? 'Project folder must be open and saved.' : 'Project files must be open.';
    } else if (requirement.kind === 'execution') {
      status = env.execution ? 'unknown' : 'missing'; detail = env.execution ? 'Ausführung ist erlaubt; benötigte Laufzeit vor dem Start prüfen.' : 'Der aktuelle Modus erlaubt keine Ausführung.'; detailEn = env.execution ? 'Execution is allowed; verify the required runtime before starting.' : 'The current mode does not allow execution.';
    } else if (requirement.kind === 'engine') {
      status = env.engines.includes(requirement.match || '') ? 'unknown' : 'missing'; detail = status === 'unknown' ? 'Projekt erkannt. Engine-Version und Laufzeit mit engine_status prüfen.' : 'Kein passendes Engine-Projekt erkannt.'; detailEn = status === 'unknown' ? 'Project detected. Verify engine version and runtime with engine_status.' : 'No matching engine project detected.';
    } else {
      const matches = env.services.filter(service => !requirement.match || words(service.name).includes(words(requirement.match)));
      status = matches.some(service => service.enabled && service.catalog && service.tools) ? 'ready' : matches.some(service => service.enabled) ? 'unknown' : 'missing';
      detail = status === 'ready' ? 'Werkzeuge im Katalog vorhanden. Den Zugriff vor der Aktion prüfen.' : status === 'unknown' ? 'Verbindung aktiv; Werkzeugkatalog oder Freigaben noch prüfen.' : 'Passende Verbindung unter Dienste einrichten und Werkzeuge freigeben.';
      detailEn = status === 'ready' ? 'Catalog tools available. Verify access before acting.' : status === 'unknown' ? 'Connection enabled; verify its catalog and tool grants.' : 'Set up a matching service and grant its tools.';
    }
    return { ...requirement, status, detail, detailEn };
  });
}
function words(value: string) { return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase(); }
/** Select short task hints; explicit choices are independent of the automatic budget. */
export function selectTaskSkills(query: string, available: SkillRecord[], env: SkillEnvironment, options: { automatic: boolean; pinned: string[]; limit: number }): SkillSelection[] {
  return routeTaskSkills(query, available, env, options, ANVIL_SKILLS).map(({ skill, explicit, pinned, reason, reasonEn }) => ({
    id: skill.id, name: skill.name, explicit: explicit || pinned, reason, reasonEn,
    requirements: skillRequirements(skill.id, env),
  }));
}

export const SKILL_TOOL_HINT_LIMIT = 8;
/** Bundled declarative bindings only. ToolSession still filters these against the
 * actual task's allowed tools; imported metadata never grants or runs a tool. */
export function skillToolHints(selection: Pick<SkillSelection, 'id'>[]): string[] {
  return [...new Set(selection.flatMap(item => builtinSkill(item.id)?.tools || []))].slice(0, SKILL_TOOL_HINT_LIMIT);
}

export function skillPackage(id: string): Record<string, string> {
  const skill = builtinSkill(id);
  if (!skill) throw Error('Anvil-Skill fehlt.');
  return { 'SKILL.md': skill.source, ...skill.resources };
}

/** A project copy must resolve its own references, rather than the bundled originals. */
export function projectSkillPackage(id: string): Record<string, string> {
  const pack = skillPackage(id), name = `${id}-projekt`;
  pack['SKILL.md'] = pack['SKILL.md'].replace(/^name:.*$/m, `name: ${name}`)
    .replaceAll(`name:"${id}"`, `name:"${name}"`)
    .replace('Eingebaute Ressourcen unter `anvil://skills/` sind keine Projektdateien für `read_file`.', 'Referenzen dieser Projektkopie liegen im Skill-Ordner. Mit skill_read die eigene Referenz oder mit read_file deren vollständigen Projektpfad lesen.');
  return pack;
}
