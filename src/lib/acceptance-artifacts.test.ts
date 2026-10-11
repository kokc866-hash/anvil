import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { verifyForegroundArtifacts } from './acceptance-artifacts.ts';
import { beginAgent, abortAgent } from './agent-abort.ts';
import { captureAgentRun } from './agent-run.ts';

const result = { anvil_acceptance: { observations: [{ criterion: 'solid', actual: 1, artifact: 'checks/geometry.json', sha256: '1234567890abcdef'.repeat(4) }] } };
function nativeWindow(t: TestContext, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value, configurable: true, writable: true });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); });
}

test('foreground artifact verification is bound to the owning project and a native result', async t => {
  beginAgent(); const run = captureAgentRun();
  let payload: unknown;
  nativeWindow(t, { anvilNative: { agentJob: async (action: string, data: unknown) => {
    assert.equal(action, 'artifact-check'); payload = data;
    return { result: { ...result, anvilArtifactChecks: [{ ...result.anvil_acceptance.observations[0], ok: true }] } };
  } } });
  const checked = await verifyForegroundArtifacts(result, 'I:/synthetic-project', run);
  assert.deepEqual(payload, { project: 'I:/synthetic-project', result });
  assert.equal((checked.anvilArtifactChecks as { ok: boolean }[])[0].ok, true);
});

test('browser or missing native verifier cannot trust a tool-supplied success flag', async t => {
  beginAgent(); const run = captureAgentRun();
  nativeWindow(t, {});
  const checked = await verifyForegroundArtifacts({ ...result, anvilArtifactChecks: [{ ok: true }] }, '', run);
  assert.equal((checked.anvilArtifactChecks as { ok: boolean }[])[0].ok, false);
  assert.deepEqual((await verifyForegroundArtifacts({ text: 'No measurement', anvilArtifactChecks: [{ ok: true }] }, '', run)).anvilArtifactChecks, []);
});

test('a late artifact result cannot enter a replaced or stopped request', async t => {
  beginAgent(); const run = captureAgentRun();
  let settle!: (value: unknown) => void;
  nativeWindow(t, { anvilNative: { agentJob: () => new Promise(resolve => { settle = resolve; }) } });
  const checked = verifyForegroundArtifacts(result, 'I:/synthetic-project', run);
  const rejected = assert.rejects(checked, /Teststopp/);
  abortAgent('Teststopp');
  settle({ result: { ...result, anvilArtifactChecks: [{ ok: true }] } });
  await rejected;
});
