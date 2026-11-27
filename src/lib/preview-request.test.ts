import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ToolSession } from './tool-compat.ts';
import { AGENT_TOOLS } from './agent-tools.ts';
import { initialAgentPlan } from './plan.ts';
import { PlanProgress } from './plan-progress.ts';
import { planRequiredKinds } from './plan-targets.ts';

const request = 'mache jetzt noch ein test mit play, es gibt jetzt mehr funktionen.';

test('ordinary browser test requests get interaction tools and a real check step without naming play', () => {
  for(const prompt of ['Teste alle Funktionen der Browseranwendung. Keine Änderungen.', 'Prüfe die Webanwendung gründlich.', 'Test the browser application without edits.']) {
    for(const mode of ['standard','compact','text'] as const)assert.ok(new ToolSession(mode,prompt).tools(AGENT_TOOLS).some(tool=>tool.function.name==='play'),prompt);
    assert.ok(initialAgentPlan(prompt).some(step=>step.kind==='check' && /play/.test(step.text)),prompt);
  }
  for(const prompt of ['Prüfe nur die Syntax der HTML-Datei.', 'Check only the syntax of this HTML file.', 'Teste Godot im Play-Modus.']) {
    assert.ok(!initialAgentPlan(prompt).some(step=>/mit play prüfen|Use play/.test(step.text)),prompt);
  }
});

test('an explicit preview interaction request offers play immediately in both tool modes', () => {
  for (const mode of ['standard', 'compact'] as const) {
    for (const prompt of [request, 'Prüfe Maus und Tastatur in der HTML-Vorschau.', 'Test clicks and keyboard shortcuts in the browser preview.']) {
      const names = new ToolSession(mode, prompt).tools(AGENT_TOOLS).map(tool => tool.function.name);
      assert.ok(names.includes('play'), `${mode}: ${prompt}`);
      assert.ok(names.includes('select_tools'));
    }
    const limited = AGENT_TOOLS.filter(tool => tool.function.name !== 'play');
    assert.equal(new ToolSession(mode, request).tools(limited).some(tool => tool.function.name === 'play'), false);
    const busy = new ToolSession(mode, request, ['git_status','git_commit','mcp_list','mcp_call','skill_list','skill_read']);
    assert.ok(busy.tools(AGENT_TOOLS).some(tool => tool.function.name === 'play'));
    assert.equal(new ToolSession(mode, 'Read notes.txt.').tools(AGENT_TOOLS).some(tool => tool.function.name === 'play'), false);
    assert.equal(new ToolSession(mode, 'Read src/play.js and explain it.').tools(AGENT_TOOLS).some(tool => tool.function.name === 'play'), false);
    assert.equal(new ToolSession(mode, 'Teste Godot im Play-Modus.').tools(AGENT_TOOLS).some(tool => tool.function.name === 'play'), false);
  }
});

test('the delivered report stays complete in the saved proof without erasing real compound requirements', () => {
  const progress = new PlanProgress();
  progress.sync(initialAgentPlan(request, undefined, 'agent'));
  const proof = progress.record('play', { actions: [{ type: 'assert', selector: '#status', text: 'Running' }] }, { ok: true, functionalChecks: true });
  assert.equal(progress.set({ updates: [{ step: 1, status: 'ok', evidence: [proof], reason: 'Expected state checked.' }] }).ok, true);
  progress.sync(progress.plan.map(step => step.kind === 'report' ? { ...step, status: 'ok' as const, completedBy: 'agent' as const } : step));
  assert.equal(progress.plan.every(step => step.status === 'ok'), true);
  const restored = new PlanProgress(); assert.equal(restored.restore(progress.snapshot()), true);
  assert.equal(restored.plan.every(step => step.status === 'ok'), true);
  assert.ok(planRequiredKinds({ text: 'Prüfe die Eingabe und berichte das Ergebnis', kind: 'report', status: 'todo' }).includes('check'));
  assert.ok(planRequiredKinds({ text: 'Prüfung starten und Ergebnis berichten', kind: 'report', status: 'todo' }).includes('check'));
  assert.ok(planRequiredKinds({ text: 'Prüfung durchführen und Ergebnis berichten', kind: 'report', status: 'todo' }).includes('check'));
});

test('a preview test seeds an actual interaction check while retaining existing user plans', () => {
  const plan = initialAgentPlan(request, undefined, 'agent', 'de');
  assert.ok(plan.some(step => step.kind === 'check' && /play/i.test(step.text)));
  assert.equal(plan.some(step => step.kind === 'edit'), false);
  const existing = [{ text: 'Vom Nutzer vorgegebener Prüfschritt', kind: 'check' as const, status: 'todo' as const }];
  assert.deepEqual(initialAgentPlan(request, existing, 'agent'), existing);
  const numbered = initialAgentPlan('1. Start anklicken\n2. Pause anklicken', undefined, 'agent');
  assert.deepEqual(numbered.map(step => step.text), ['Start anklicken', 'Pause anklicken']);
  assert.ok(initialAgentPlan('Please test clicks in the browser preview.', undefined, 'agent', 'en').some(step => step.kind === 'check' && /play/.test(step.text)));
  assert.deepEqual(initialAgentPlan('Erkläre das Werkzeug play.', undefined, 'agent'), []);
});

test('a loaded preview or delivered key cannot certify the requested interaction check', () => {
  const progress = new PlanProgress();
  progress.sync([{ text: 'Bedienung mit play prüfen und erwartete Zustände bestätigen', kind: 'check', status: 'todo' }]);
  const render = progress.record('run_file', { path: 'index.html' }, { ok: true, graphical: true, image: 'synthetic-frame' });
  assert.match(progress.set({ updates: [{ step: 1, status: 'ok', evidence: [render], reason: 'HTML loaded only.' }] }).error || '', /play.*assert/);
  const input = progress.record('play', { keys: [' '] }, { ok: true, image: 'synthetic-frame' });
  assert.ok(progress.set({ updates: [{ step: 1, status: 'ok', evidence: [input], reason: 'Input delivered only.' }] }).error);
  const checked = progress.record('play', { actions: [{ type: 'assert', selector: '#status', text: 'Running' }] }, { ok: true, functionalChecks: true });
  assert.equal(progress.set({ updates: [{ step: 1, status: 'ok', evidence: [checked], reason: 'Expected DOM state confirmed.' }] }).ok, true);
  const restored = new PlanProgress(); assert.equal(restored.restore(progress.snapshot()), true);
  assert.equal(restored.plan[0].status, 'ok');
  restored.setInputStamp('a'.repeat(64));
  assert.equal(restored.plan[0].status, 'todo', 'old or missing input identity cannot certify changed code');
});
