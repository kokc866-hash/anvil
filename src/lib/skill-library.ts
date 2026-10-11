import { ANVIL_SKILLS } from './anvil-skills.generated.ts';

export type SkillRequirement = { kind: 'project' | 'engine' | 'service' | 'execution'; label: string; labelEn: string; match?: string };
export type AnvilSkill = { id: string; title: string; titleEn: string; description: string; category: string; categoryLabel: string; categoryLabelEn: string; keywords: string[]; requirements: SkillRequirement[]; readOnly: boolean; version: string; body: string; source: string; resources: Record<string, string> };
export type SkillRecord = { id: string; name: string; when: string; body: string; builtin?: boolean; file?: string; scope?: string; uses?: number; wins?: number; fails?: number; score?: number };
export type SkillEnvironment = { project: boolean; saved?: boolean; engines: string[]; execution: boolean; services: { name: string; enabled: boolean; catalog: boolean; tools: boolean }[] };
export type RequirementStatus = SkillRequirement & { status: 'ready' | 'missing' | 'unknown'; detail: string; detailEn: string };
export type SkillSelection = { id: string; name: string; reason: string; reasonEn: string; requirements: RequirementStatus[]; explicit: boolean };
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
    return { ...seed, uses: previous?.uses ?? 0, wins: previous?.wins ?? 0, fails: previous?.fails ?? 0 };
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
function keywordHit(query: string, keyword: string) {
  const normalized = words(keyword).trim();
  if (!normalized) return false;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(query);
}

/** Select from the actual task. Project context only reinforces a task match. */
export function selectTaskSkills(query: string, available: SkillRecord[], env: SkillEnvironment, options: { automatic: boolean; pinned: string[]; limit: number }): SkillSelection[] {
  query = query.match(/\n\n(?:Mein Auftrag|My task): ([\s\S]+)$/)?.[1] || query;
  if (!query.trim()) return [];
  const q = words(query);
  const ranked = available.map(skill => {
    const builtin = builtinSkill(skill.id);
    const explicit = new RegExp(`\\$${skill.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9-])`, 'i').test(query);
    const pinned = options.pinned.includes(skill.id);
    const hits = (builtin?.keywords || (skill.when.match(/[\p{L}\p{N}_-]+/gu) || []).filter(word => word.length > 3)).filter(keyword => keywordHit(q, keyword));
    const domain = builtin?.requirements.find(requirement => requirement.kind === 'engine' || requirement.kind === 'service');
    const context = domain?.kind === 'engine' && env.engines.includes(domain.match || '') ? 2 : 0;
    return { skill, explicit, pinned, hits, rank: explicit ? 1000 : pinned ? 900 : options.automatic && hits.length ? hits.length * 10 + context : 0 };
  }).filter(item => item.rank > 0).sort((a, b) => b.rank - a.rank || a.skill.id.localeCompare(b.skill.id));
  return ranked.slice(0, Math.max(0, Math.min(3, options.limit))).map(({ skill, explicit, pinned, hits }) => ({
    id: skill.id, name: skill.name, explicit: explicit || pinned,
    reason: explicit ? 'Im Auftrag ausdrücklich genannt.' : pinned ? 'Für dieses Projekt angeheftet.' : `Passt zum Auftrag: ${hits.slice(0, 3).join(', ')}.`,
    reasonEn: explicit ? 'Explicitly named in the task.' : pinned ? 'Pinned for this project.' : `Matches the task: ${hits.slice(0, 3).join(', ')}.`,
    requirements: skillRequirements(skill.id, env),
  }));
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
