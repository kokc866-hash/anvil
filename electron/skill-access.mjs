/** Separate memory permission from instruction skills, including legacy snapshots. */
/** @param {any} snapshot */
export function knowledgeAccess(snapshot) {
  const enabled = snapshot?.enabled === true;
  return {
    memory: enabled && snapshot.memoryEnabled !== false,
    skills: enabled && snapshot.skillsEnabled !== false,
    bodies: enabled && snapshot.skillsEnabled !== false && snapshot.skillBodies !== false,
  };
}

/** Supporting references are read explicitly; never disclose every resource on entry. */
/** @template {Record<string,any>} T @param {T} skill */
export function publicSkill(skill) {
  const { resourceContents: _resourceContents, ...value } = skill;
  return value;
}

/** @param {any} skill @param {unknown} resource @param {Record<string,string>} files */
export function readSkillResource(skill, resource, files = {}) {
  const missing = { error: 'Diese Referenz gehört nicht zum Skill. Verfügbare Referenzen stehen in resources.' };
  if (typeof resource !== 'string' || !resource || /[\\:]/.test(resource) || [...resource].some(char => char.charCodeAt(0) < 32) || resource.split('/').some(part => !part || ['.', '..', '__proto__', 'constructor', 'prototype'].includes(part))) return missing;
  if (Object.hasOwn(skill.resourceContents || {}, resource)) return { skill: skill.name, resource, content: skill.resourceContents[resource] };
  const base = skill.baseDirectory || skill.file?.replace(/\/[^/]+$/, '');
  const full = base && (resource.startsWith(`${base}/`) ? resource : `${base}/${resource}`);
  if (!full || !skill.resources?.includes(full) || !Object.hasOwn(files, full)) return missing;
  return { skill: skill.name, resource, content: files[full] };
}

/** Record a later explicit load without replacing the original selection reason. */
/** @param {any[]} entries @param {{id?:string,name:string}|undefined} skill @param {string} tool */
export function withLoadedSkill(entries, skill, tool) {
  if (!skill || entries.some(entry => entry.id === skill.id || entry.name === skill.name)) return entries;
  return [...entries, { id: skill.id || skill.name, name: skill.name, explicit: true, requirements: [],
    reason: `Im Auftrag über ${tool} geladen.`, reasonEn: `Loaded during the task using ${tool}.` }];
}
