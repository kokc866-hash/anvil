// Shared, pure reconciliation rules. Versions detect edits, they are not security hashes.
/** @param {unknown} value */
export const normalizeKnowledgeText = value => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
/** @param {any} value */
export const knowledgeFactKey = value => JSON.stringify([value.ws || '', normalizeKnowledgeText(value.text)]);
/** @param {any} value */
export const knowledgeSkillKey = value => JSON.stringify([value.scope === 'project' ? value.ws || 'legacy' : '', normalizeKnowledgeText(value.name)]);
/** @param {any} value */
export function knowledgeVersion(value) {
  if (!value) return null;
  const fields = value.name ? ['id','name','when','body','kind','scope','ws','file','frontmatter','uses','score','wins','fails'] : ['id','kind','text','conf','hits','scope','ws'];
  const data = JSON.stringify(fields.map(key => [key, value[key] ?? ({uses:0,score:0.6,wins:0,fails:0}[key] ?? null)]));
  let hash = 2166136261, second = 5381;
  for (let i=0;i<data.length;i++) { hash = Math.imul(hash ^ data.charCodeAt(i),16777619); second = Math.imul(second,33) ^ data.charCodeAt(i); }
  return `${data.length}:${hash >>> 0}:${second >>> 0}`;
}
/** @param {string} content */
export const knowledgeFileVersion = content => knowledgeVersion({text:content});
/** @param {any} snapshot */
export function knowledgePermissions(snapshot) {
  return JSON.stringify([snapshot?.enabled===true,...['personEnabled','projectEnabled','skillsEnabled','skillBodies','pluginSkills'].map(key => snapshot?.[key] !== false)]);
}
/** Returns a new store fragment; never overwrites concurrently edited/deleted records.
 * @param {{facts:any[],skills:any[],forgotten:string[],forgottenFacts:string[]}} state
 * @param {any} event
 */
export function mergeKnowledgeEvent(state, event) {
  const field = event.collection === 'facts' ? 'facts' : 'skills';
  const records = state[field] || [], current = records.find(x => x.id === event.recordId);
  if (knowledgeVersion(current) !== event.beforeVersion) return {state, conflict:true};
  if (!current && event.after) {
    const key = field === 'facts' ? knowledgeFactKey : knowledgeSkillKey;
    if (records.some(x => key(x) === key(event.after))) return {state, conflict:true};
    if (field === 'facts' && (state.forgottenFacts || []).includes(key(event.after))) return {state, conflict:true};
    if (field === 'skills' && (state.forgotten || []).some(x=>[key(event.after),event.after.id,event.after.name].includes(x)&&!(event.allowForgotten||[]).includes(x))) return {state, conflict:true};
  }
  const next = {...state, [field]:event.after ? [event.after,...records.filter(x=>x.id!==event.recordId)] : records.filter(x=>x.id!==event.recordId)};
  if(field==='facts'&&!event.after&&event.before)next.forgottenFacts=[...new Set([...(state.forgottenFacts||[]),knowledgeFactKey(event.before)])];
  if(field==='skills'&&event.after&&['write','patch'].includes(event.action))next.forgotten=(state.forgotten||[]).filter(key=>![event.after.id,event.after.name,knowledgeSkillKey(event.after)].includes(key));
  return {state:next,conflict:false};
}
