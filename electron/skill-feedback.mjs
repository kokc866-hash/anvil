import { knowledgeVersion } from './agent-knowledge-state.mjs';

/** Stable instruction identity, independent of usage and reported outcomes.
 * @param {any} skill */
export function skillInstructionVersion(skill) {
  return knowledgeVersion({ id: skill.id, name: skill.name, when: skill.when || skill.description,
    body: skill.body, kind: skill.kind, scope: skill.scope, ws: skill.ws, file: skill.file,
    frontmatter: skill.frontmatter, uses: 0, score: .6, wins: 0, fails: 0, feedback: [] });
}

/** Feedback is an agent report, never a verification result or permission change.
 * @param {any} skill
 * @param {string} kind
 * @param {{id:string,jobId:string,version:string,at?:number}} context */
export function recordSkillFeedback(skill, kind, context) {
  if (!['ok', 'fail', 'reject', 'undo'].includes(kind)) throw Error('Unbekannte Skill-Rückmeldung.');
  if (!context.id || !context.jobId || context.version !== skillInstructionVersion(skill)) throw Error('Die Anleitung wurde seit ihrer Verwendung geändert. Rückmeldung nicht zugeordnet.');
  const feedback = Array.isArray(skill.feedback) ? skill.feedback : [];
  if (feedback.some(/** @param {{id:string}} entry */ entry => entry.id === context.id)) return skill;
  return { ...skill, feedback: [...feedback, { id: context.id, jobId: context.jobId, version: context.version,
    kind, at: context.at ?? Date.now(), source: 'agent' }].slice(-20) };
}
