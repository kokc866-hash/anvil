import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseReadiness } from './verify-release-readiness.mjs';
test('signed release refuses absent owner decisions without blocking unsigned builds', () => {
  assert.equal(releaseReadiness({}).length, 4);
  assert.equal(releaseReadiness({ publisher: 'TODO', supportUrl: 'https://example.com', license: { name: 'TBD', url: 'file:///terms' }, signing: {} }).length, 4);
});
test('configured release identity passes metadata gate only', () => {
  assert.deepEqual(releaseReadiness({ publisher: 'QA Company', supportUrl: 'https://anvil.test/support', license: { name: 'QA terms', url: 'https://anvil.test/terms' }, signing: { subjectName: 'QA Company' } }), []);
});
