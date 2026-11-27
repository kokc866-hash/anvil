import { load, FAILSAFE_SCHEMA } from 'js-yaml';
import { useIde } from '@/store/ide';
import { useLearn, workspaceId, type LearnSkill } from './learn';
import { serializeSkillMd } from './learn-parse';
import { builtinSkill, skillPackage } from './skill-library';
import { debugSkill } from './skill-debug';
import { importedAgentPlugins, pluginOwnedPaths } from './agent-plugin-registry';
import { commitSkillFiles, removeAgentPlugin } from './agent-plugin-install';
import { flushPersistence } from './persist-storage';
import { isSecretPath } from './ref';
import { knowledgeSkillKey } from '../../electron/agent-knowledge-state.mjs';
import { hasAsciiControl } from '../../electron/text-controls.mjs';

export type SkillSource = { kind: 'builtin' | 'project' | 'user' | 'package'; name: string; version?: string; compatibility?: string; packageId?: string; file?: string };

function skillFile(file: string) {
  if (!file.startsWith('.anvil/skills/') || /[\\:]/.test(file) || hasAsciiControl(file) || file.split('/').some(part => !part || part === '.' || part === '..') || !/\.md$/i.test(file)) throw Error('Ungültiger Skill-Dateipfad.');
  return file;
}

function metadata(skill: LearnSkill): Record<string, unknown> {
  try { const value = load(skill.frontmatter || '', { schema: FAILSAFE_SCHEMA }); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
  catch { return {}; }
}

export function skillSource(skill: LearnSkill): SkillSource {
  const bundled = builtinSkill(skill.id);
  if (bundled && skill.builtin) return { kind: 'builtin', name: 'Anvil', version: bundled.version, compatibility: bundled.compatibility };
  const fields = metadata(skill), meta = fields.metadata && typeof fields.metadata === 'object' ? fields.metadata as Record<string, unknown> : {};
  const pack = skill.scope === 'project' && skill.ws === workspaceId() ? importedAgentPlugins(useIde.getState().files).find(pack => skill.file && pluginOwnedPaths(useIde.getState().files, pack.id).includes(skill.file)) : undefined;
  return { kind: pack ? 'package' : skill.scope === 'project' ? 'project' : 'user', name: pack?.name || skill.name,
    version: typeof meta.version === 'string' ? meta.version : pack?.version,
    compatibility: typeof fields.compatibility === 'string' ? fields.compatibility : undefined,
    packageId: pack?.id, file: skill.scope === 'project' ? skill.file : undefined };
}

/** Export only this skill and its own supporting files, never neighboring skills. */
export function managedSkillPackage(skill: LearnSkill): Record<string, string> {
  if (skill.builtin && builtinSkill(skill.id)) return skillPackage(skill.id);
  const files = useIde.getState().files, folder = skill.scope === 'project' && skill.ws === workspaceId() && skill.file ? skillFile(skill.file).match(/^(.*)\/SKILL\.md$/i)?.[1] : undefined;
  const pack: Record<string, string> = {};
  if (folder) for (const [file, body] of Object.entries(files)) {
    if (file.startsWith(folder + '/') && !isSecretPath(file)) pack[file.slice(folder.length + 1)] = body;
  }
  // User-level instructions live in the profile; their old exported file is not authoritative.
  pack['SKILL.md'] = serializeSkillMd({ ...skill, kind: 'guide', scope: 'project' });
  return pack;
}

function currentSkill(id: string) {
  const state = useIde.getState(), skill = useLearn.getState().skills.find(skill => skill.id === id);
  if (!skill || skill.scope === 'project' && skill.ws !== workspaceId()) throw Error('Dieser Skill gehört nicht zum aktuellen Projekt.');
  if (state.agentBusy || state.pathOperation) throw Error('Das Projekt wird gerade bearbeitet. Versuche es danach erneut.');
  if (skill.builtin || builtinSkill(skill.id)) throw Error('Vorinstallierte Skills als eigene Projektkopie bearbeiten.');
  return { state, skill, source: skillSource(skill) };
}

export async function saveManagedSkill(id: string, edit: { when: string; body: string }): Promise<void> {
  const { state, skill, source } = currentSkill(id);
  if (source.kind === 'package') throw Error('Paket-Skills als eigene Projektkopie bearbeiten.');
  const next = { ...skill, when: edit.when.trim(), body: edit.body.trim(), owned: true, at: Date.now() };
  const pack = managedSkillPackage(next);
  const report = debugSkill(next, { resources: Object.keys(pack).filter(file => file !== 'SKILL.md') });
  if (!report.ok) throw Error(report.issues.join(' '));
  if (skill.scope === 'project') {
    const file = skillFile(skill.file || `.anvil/skills/${skill.id}.md`);
    await commitSkillFiles({ [file]: serializeSkillMd(next) }, state.workspaceEpoch);
  } else {
    useLearn.setState(current => ({ skills: current.skills.map(value => value.id === id ? { ...next, file: undefined } : value) }));
    await flushPersistence();
  }
}

export async function removeManagedSkill(id: string): Promise<void> {
  const { state, skill, source } = currentSkill(id);
  if (source.packageId) {
    const expected = Object.fromEntries(pluginOwnedPaths(state.files, source.packageId).map(file => [file, state.files[file]]));
    await removeAgentPlugin(source.packageId, expected, state.workspaceEpoch);
    return;
  }
  if (skill.scope === 'project') {
    const file = skillFile(skill.file || `.anvil/skills/${skill.id}.md`);
    const folder = file.match(/^(.*)\/SKILL\.md$/i)?.[1];
    const paths = folder ? Object.keys(state.files).filter(file => file.startsWith(folder + '/')) : [skill.file || `.anvil/skills/${skill.id}.md`].filter(file => Object.hasOwn(state.files, file));
    const wrapper = `plugins/skills/${skill.id}.js`;
    if (skill.owned && skill.kind === 'plugin' && Object.hasOwn(state.files, wrapper)) paths.push(wrapper);
    if (paths.length) await commitSkillFiles(Object.fromEntries(paths.map(file => [file, null])), state.workspaceEpoch);
  }
  const key = knowledgeSkillKey(skill);
  useLearn.setState(current => ({ skills: current.skills.filter(value => value.id !== id),
    forgotten: [...new Set([...current.forgotten, key, ...(skill.scope === 'user' ? [id] : [])])],
    activeSkills: current.activeSkills.filter(value => value !== id),
    skillSelection: current.skillSelection.filter(value => value.id !== id),
    pinnedSkills: Object.fromEntries(Object.entries(current.pinnedSkills).map(([ws, pins]) => [ws, pins.filter(value => value !== id)])) }));
  await flushPersistence();
}
