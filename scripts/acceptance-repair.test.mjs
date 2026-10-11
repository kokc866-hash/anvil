import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { TaskAcceptance } from '../electron/task-acceptance.mjs';

const sha256 = createHash('sha256').update('Synthetic saved CAD verification fixture').digest('hex');
const criterion = { id: 'single_solid', label: 'Ein zusammenhängender Körper', required: true, operator: 'eq', expected: 1 };
const envelope = (actual = 1, hash = sha256) => ({ anvil_acceptance: { observations: [{ criterion: criterion.id, actual, artifact: 'checks/geometry.json', sha256: hash }] } });
const wrapped = value => `Headless FreeCAD script finished (exit 0).\nOutput:\n${JSON.stringify(value, null, 2)}\nIf the script saved a document that is open in the GUI, call reload_document to see the result.`;
const setup = (criteria = [criterion]) => { const a = new TaskAcceptance(); a.setInputStamp('fixture'); assert.equal(a.define(criteria).ok, true); return a; };
const record = (a, raw) => { a.record('mcp_call', raw, 'e1', { failed: false, pending: false, changed: false }); return a.result(); };

test('real FreeCAD multiline wrapper preserves explicit measurements, including braces in JSON strings', () => {
  const value = { message: 'Quoted braces } and { with escaped "quotes"', ...envelope() };
  const result = record(setup(), { isError: false, text: wrapped(value) });
  assert.equal(result.state, 'passed');
  assert.equal(result.observations.length, 1);
});

test('conflicting multiline blocks stay unverified, and truncated or malformed JSON cannot be salvaged as a pass', () => {
  const conflicting = record(setup(), { text: `${wrapped(envelope())}\n${wrapped(envelope(3))}` });
  assert.equal(conflicting.state, 'stale');
  for (const text of [wrapped(envelope()).replace(/}\nIf/, '\nIf'), `Output:\n{\nBROKEN\n${JSON.stringify(envelope())}\n}`, 'All tests passed.']) {
    assert.ok(['unverified', 'stale'].includes(record(setup(), { text }).state));
  }
});

test('placeholder hashes cannot certify work and their cause survives a saved acceptance snapshot', () => {
  for (const char of ['a', 'b', 'c', '0']) {
    const a = setup();
    const result = record(a, { structuredContent: envelope(1, char.repeat(64)) });
    assert.equal(result.state, 'unverified');
    assert.match(result.checks[0].reason || '', /Platzhalter/);
    const resumed = new TaskAcceptance(); assert.equal(resumed.restore(a.snapshot()), true);
    assert.match(resumed.result().checks[0].reason || '', /Platzhalter/);
  }
});

test('a string expectation stays binding while a numeric measurement reports the type mismatch explicitly', () => {
  const a = setup([{ ...criterion, expected: '1' }]);
  const result = record(a, { structuredContent: envelope() });
  assert.equal(result.state, 'failed');
  assert.equal(result.criteria[0].expected, '1');
  assert.match(result.checks[0].reason || '', /Datentyp/);
});

test('an invalid duplicate cannot keep the same criterion green, including after restoring an old placeholder', () => {
  const a=setup();
  record(a, envelope());
  const mixed={anvil_acceptance:{observations:[...envelope().anvil_acceptance.observations,...envelope(1,'a'.repeat(64)).anvil_acceptance.observations]}};
  const result=record(a,mixed);
  assert.notEqual(result.state,'passed');
  assert.equal(result.checks[0].state,'unverified');
  const old=setup();record(old,envelope());const saved=old.snapshot();saved.observations[0].sha256='a'.repeat(64);
  const restored=new TaskAcceptance();assert.equal(restored.restore(saved),true);
  assert.equal(restored.result().state,'unverified');
  assert.match(restored.result().checks[0].reason,/Platzhalter/);
});

test('a fresh valid measurement clears a previous missing-artifact or placeholder issue', () => {
  for(const invalid of [envelope(1,'a'.repeat(64)),{...envelope(),anvilArtifactChecks:[{artifact:'checks/geometry.json',sha256,ok:false,reason:'Datei fehlt.',reasonEn:'File missing.'}]}]){
    const a=setup();assert.equal(record(a,invalid).state,'unverified');
    const recovered=new TaskAcceptance();assert.equal(recovered.restore(a.snapshot()),true);
    const result=record(recovered,{...envelope(),anvilArtifactChecks:[{artifact:'checks/geometry.json',sha256,ok:true}]});
    assert.equal(result.state,'passed');
    assert.equal(result.checks[0].reason,undefined);
  }
});
