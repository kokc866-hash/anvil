import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withPlanStatus, planCompletionTitle } from './plan-status.ts';
import { PlanProgress } from './plan-progress.ts';

test('manual completion is explicit and resetting removes its provenance', () => {
  const manual = withPlanStatus({ text: 'Funktion testen', status: 'todo', kind: 'check' }, 'ok', 'user');
  assert.equal(manual.completedBy, 'user');
  assert.match(planCompletionTitle(manual)!, /Manuell/);
  assert.deepEqual(withPlanStatus(manual, 'todo'), { text: 'Funktion testen', status: 'todo', kind: 'check' });
});

test('recovery preserves known manual provenance without inventing a source for legacy marks', () => {
  const progress = new PlanProgress();
  progress.sync([{ text: 'Funktion testen', status: 'ok', kind: 'check', completedBy: 'user' }, { text: 'Älterer Schritt', status: 'ok' }]);
  const restored = new PlanProgress();
  assert.equal(restored.restore(progress.snapshot()), true);
  assert.equal(restored.plan[0].completedBy, 'user');
  assert.equal(restored.plan[1].completedBy, undefined);
  assert.match(planCompletionTitle(restored.plan[1])!, /nicht gespeichert/);
});

test('the agent can only record completion provenance after matching actual evidence', () => {
  const progress = new PlanProgress();
  progress.sync([{ text: 'Datei lesen', status: 'todo', kind: 'read' }]);
  assert.ok(progress.set({ updates: [{ step: 1, status: 'ok', reason: 'guessed', evidence: ['missing'] }] }).error);
  assert.equal(progress.plan[0].completedBy, undefined);
  const id = progress.record('read_file', { path: 'main.js' }, { ok: true, content: '1' });
  assert.equal(progress.set({ updates: [{ step: 1, status: 'ok', reason: 'read delivered', evidence: [id] }] }).ok, true);
  assert.equal(progress.plan[0].completedBy, 'agent');
});
