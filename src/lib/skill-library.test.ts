import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANVIL_SKILLS, librarySeeds, mergeSkillLibrary, selectTaskSkills, skillRequirements, skillPackage, type SkillEnvironment, type SkillRecord } from './skill-library.ts';
import { parseSkillMd } from './learn-parse.ts';
import { debugSkill } from './skill-debug.ts';
import { planSkillPackage, skillPackageZip } from './skill-package.ts';
import { readPluginZip } from './agent-plugin-archive.ts';

const environment: SkillEnvironment = { project: true, saved: true, execution: true, engines: ['godot'], services: [] };
const skills = librarySeeds();
const select = (query: string, available = skills, automatic = true, pinned: string[] = []) => selectTaskSkills(query, available, environment, { automatic, pinned, limit: 2 });

test('a real Godot task selects its engine guide, not unrelated installed specialists', () => {
  const selected = select('Ändere die Godot-Szene und ergänze einen Regressionstest.');
  assert.ok(selected.some(skill => skill.id === 'anvil-godot'));
  assert.equal(selected.some(skill => /blender|freecad|unreal|github/.test(skill.id)), false);
  assert.equal(select('Wie spät ist es?').length, 0);
  assert.ok(select('Bitte prüfe und committe nur src/main.gd. README.md ist unabhängig geändert.').some(skill => skill.id === 'anvil-git'));
});
test('workflow boilerplate is not mistaken for the user task', () => {
  const selected = select('Arbeitsablauf: Änderung umsetzen\n\nNutze Tests, Git, Godot, Blender und Code.\n\nMein Auftrag: Beschreibe die FreeCAD-Skizze.');
  assert.deepEqual(selected.map(skill => skill.id), ['anvil-freecad']);
});
test('manual mode, explicit names, disabled records and selection limits are respected', () => {
  assert.equal(select('Godot verbessern', skills, false).length, 0);
  assert.deepEqual(select('$anvil-godot erkläre diese Szene', skills, false).map(skill => skill.id), ['anvil-godot']);
  assert.equal(select('$anvil-godotx erkläre diese Szene', skills, false).length, 0);
  assert.equal(select('$anvil-godot', skills.filter(skill => skill.id !== 'anvil-godot')).length, 0);
  assert.deepEqual(select('Diesen Punkt bearbeiten', skills, false, ['anvil-tests']).map(skill => skill.id), ['anvil-tests']);
  assert.ok(select('Godot Unity Unreal Blender GitHub Tests').length <= 2);
});
test('a connection is not proof of tool access, an engine project is not an installed runtime', () => {
  assert.equal(skillRequirements('anvil-godot', environment).find(row => row.kind === 'engine')?.status, 'unknown');
  assert.equal(skillRequirements('anvil-git', { ...environment, saved: false })[0].status, 'missing');
  assert.equal(skillRequirements('anvil-freecad', environment)[0].status, 'missing');
  const servers = { ...environment, services: [{ name: 'FreeCAD', enabled: true, catalog: false, tools: false }] };
  assert.equal(skillRequirements('anvil-freecad', servers)[0].status, 'unknown');
  assert.equal(skillRequirements('anvil-freecad', { ...servers, services: [{ ...servers.services[0], catalog: true, tools: true }] })[0].status, 'ready');
  assert.equal(skillRequirements('anvil-dienste', servers)[0].status, 'unknown');
});
test('updating bundled instructions preserves user skills, even a colliding identifier', () => {
  const own = { id: 'anvil-tests', name: 'my-existing-skill', when: 'own guide', body: 'User instructions must survive.', scope: 'project' };
  const old = { ...skills.find(skill => skill.id === 'anvil-tests')!, body: 'Old bundled version', uses: 8 };
  const merged = mergeSkillLibrary<SkillRecord>([own, old]);
  assert.notEqual(merged.find(skill => skill.id === 'anvil-tests')?.body, old.body);
  assert.equal(merged.find(skill => skill.id === 'anvil-tests')?.uses, 8);
  assert.equal(merged.find(skill => skill.name === own.name)?.body, own.body);
  assert.notEqual(merged.find(skill => skill.name === own.name)?.id, old.id);
});
test('every native pack exports/imports actual markdown and its referenced resources', async () => {
  assert.equal(ANVIL_SKILLS.length, 16);
  for (const skill of ANVIL_SKILLS) {
    const pack = skillPackage(skill.id), parsed = parseSkillMd(pack['SKILL.md'], `${skill.id}/SKILL.md`);
    assert.ok(parsed);
    assert.equal(parsed.name, skill.id);
    assert.ok(debugSkill(parsed).ok, skill.id);
    assert.ok(parsed.body.length < 3500, 'entrypoints should stay small; detailed references are separate');
    const source = Object.fromEntries(Object.entries(pack).map(([path, body]) => [`${skill.id}/${path}`, body]));
    const imported = planSkillPackage(source, { 'keep.txt': 'USER DATA' });
    assert.equal(imported.skill.name, skill.id);
    const bytes = skillPackageZip(source);
    const zip = await readPluginZip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    assert.deepEqual({ ...zip }, source);
    assert.ok(skill.resources && Object.keys(pack).length === Object.keys(skill.resources).length + 1);
  }
});
