import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentMessageContent } from './agent-output.ts';

test('old generated verdicts disappear from displayed and reused chat while actual content stays intact', () => {
  const legacy = { role: 'assistant', content: 'Gesamtabnahme: Nicht nachgewiesen. Alte Pflichtprüfung.\n\nDas Modell wurde gespeichert.', acceptance: { state: 'unverified' } };
  assert.equal(agentMessageContent(legacy), 'Das Modell wurde gespeichert.');
  assert.ok(legacy.content.startsWith('Gesamtabnahme:'), 'Stored historical data is not rewritten');
  assert.equal(agentMessageContent({ ...legacy, content: 'Task acceptance: Failed.\n\nThe test failed.' }), 'The test failed.');
  assert.equal(agentMessageContent({ role: 'user', content: legacy.content }), legacy.content);
  assert.equal(agentMessageContent({ role: 'assistant', content: legacy.content }), legacy.content, 'Ordinary model text without the legacy marker is unchanged');
});
