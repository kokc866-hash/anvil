import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { load } from 'js-yaml';
import { ANVIL_SKILLS, librarySeeds, selectTaskSkills, skillPackage, type SkillEnvironment } from './skill-library.ts';
import { debugSkill } from './skill-debug.ts';
import { selectRunTarget } from './run-target.ts';
import { agentTaskPolicy } from './agent-task-policy.ts';

type Scenario = { prompt: string; expected: string; files?: Record<string, string>; environment?: string };
const evaluation = JSON.parse(readFileSync('fixtures/skills/evaluations.json', 'utf8')) as { skills: { skill: string; routing?: boolean; positive: Scenario; boundary: Scenario; missing: Scenario }[] };

test('every bundled skill has a current static package check and retains export compatibility metadata', () => {
  for (const skill of ANVIL_SKILLS) {
    const pack = skillPackage(skill.id), front = load(pack['SKILL.md'].match(/^---\n([\s\S]*?)\n---/)![1]) as { compatibility: string; metadata: { version: string } };
    assert.equal(front.compatibility, skill.compatibility);
    assert.equal(front.metadata.version, skill.version);
    const checked = debugSkill({ name: skill.id, when: skill.description, body: skill.body }, { resources: skill.resources });
    assert.equal(checked.ok, true, `${skill.id}: ${checked.issues.join('; ')}`);
    assert.equal(checked.checks.references, 'pass');
    assert.equal(checked.checks.behavior, 'unverified', 'Static validation must never claim model behavior was tested');
  }
});

test('all bundled workflows have concrete positive, boundary and missing-environment evaluation scenarios', () => {
  assert.deepEqual(evaluation.skills.map(item => item.skill).sort(), ANVIL_SKILLS.map(skill => skill.id).sort());
  for (const entry of evaluation.skills) for (const key of ['positive', 'boundary', 'missing'] as const) {
    const scenario = entry[key];
    assert.ok(scenario.prompt.trim(), `${entry.skill}:${key} needs a task`);
    assert.ok(scenario.expected.trim(), `${entry.skill}:${key} needs an expected outcome`);
    if (key === 'missing') assert.ok(scenario.environment?.trim(), `${entry.skill} needs its missing prerequisite`);
    for (const path of Object.keys(scenario.files || {})) assert.ok(!path.startsWith('/') && !/[\\:]/.test(path) && !path.split('/').includes('..'), 'Evaluation fixtures stay inside their isolated project');
  }
});

test('the new workflow instructions are discoverable through actual task selection', () => {
  const environment: SkillEnvironment = { project: true, saved: true, execution: true, engines: [], services: [] };
  for (const entry of evaluation.skills.filter(item => item.routing)) {
    const selected = selectTaskSkills(entry.positive.prompt, librarySeeds(), environment, { automatic: true, pinned: [], limit: 2 });
    assert.ok(selected.some(skill => skill.id === entry.skill), `${entry.skill}: ${selected.map(skill => skill.id).join(', ')}`);
  }
});

test('the application-evaluation fixture uses the real browser entry and preserves the negative test contract', () => {
  const entry = evaluation.skills.find(item => item.skill === 'anvil-anwendung-pruefen')!;
  assert.equal(selectRunTarget(Object.keys(entry.positive.files!), 'game.js', entry.positive.files), 'index.html');
  const policy = agentTaskPolicy(entry.boundary.prompt);
  assert.equal(policy.allowRepair, false);
  assert.equal(policy.allowChanges, false);
  assert.equal(policy.negativeTest, true);
});
