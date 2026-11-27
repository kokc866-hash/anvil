import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PRODUCT_WORKFLOWS, workflowDraft, workflowSkills, workflowRequirements } from './product-workflows.ts';
import { builtinSkill, librarySeeds, selectTaskSkills, type SkillEnvironment } from './skill-library.ts';
const env: SkillEnvironment = {project: true, saved: true, engines: ['godot'], services: [], execution: true};

test('guided tasks reuse actual built-in skills and preserve editable user instructions', () => {
  for (const flow of PRODUCT_WORKFLOWS) if (flow.skill) assert.ok(builtinSkill(flow.skill), flow.skill);
  const ids = workflowSkills('scene', env);
  assert.deepEqual(ids, ['anvil-godot']);
  const draft = workflowDraft('scene', 'Verschiebe nur den Baum um zwei Meter.', 'de', ids);
  assert.match(draft.text, /Verschiebe nur den Baum um zwei Meter/);
  const selected = selectTaskSkills(draft.text, librarySeeds(), env, {automatic: false, pinned: [], limit: 2});
  assert.ok(selected.some(skill => skill.id === 'anvil-godot' && skill.explicit));
  const again = workflowDraft('debug', draft.text, 'de', ['anvil-fehler-beheben']);
  assert.match(again.text, /Verschiebe nur den Baum um zwei Meter/);
  assert.doesNotMatch(again.text, /\$anvil-godot/);
  assert.equal((again.text.match(/Mein Auftrag:/g) || []).length, 1);
});
test('scene and CAD suggestions follow detected projects or configured services', () => {
  assert.deepEqual(workflowSkills('scene', {...env, engines: []}), []);
  assert.deepEqual(workflowSkills('scene', {...env, engines: [], services: [{name: 'Blender', enabled: true, catalog: false, tools: false}]}), ['anvil-blender']);
  assert.deepEqual(workflowSkills('cad', env, {'part.scad': ''}), ['anvil-openscad']);
  const cad = {...env, engines: [], services: [{name: 'FreeCAD', enabled: true, catalog: false, tools: false}]};
  assert.deepEqual(workflowSkills('cad', cad), ['anvil-freecad']);
  const missing = workflowRequirements(['anvil-freecad'], cad);
  assert.ok(missing.some(item => item.kind === 'service' && item.status === 'unknown'));
  const ready = {...cad, services: [{...cad.services[0], catalog: true, tools: true}]};
  assert.equal(workflowRequirements(['anvil-freecad'], ready).some(item => item.kind === 'service'), false);
});
