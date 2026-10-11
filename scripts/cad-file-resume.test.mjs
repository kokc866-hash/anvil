import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { listTree, readRelFiles } from '../companion/git.mjs';
import { fileBytes, sameBytes } from './file-content.mjs';
import { AgentProjectRuntime } from '../electron/agent-project-runtime.mjs';
import { AgentJobHost } from '../electron/agent-job-host.mjs';

test('FreeCAD archives survive native reload, stopped-host recovery and controlled resume byte for byte', async t => {
  mkdirSync(resolve('artifacts/resume-fix-2026-10-08'), { recursive: true });
  const root = mkdtempSync(resolve('artifacts/resume-fix-2026-10-08/cad-'));
  const binary = Buffer.from([0x50, 0x4b, 3, 4, 0, 255, 128, 65, 10]);
  const originals = {
    'Stage.FCStd': binary,
    'Stage.20261008-051748.FCBak': binary,
    'Stage.FCStd1': binary,
    'utf8-bom.py': Buffer.from('\ufeffprint("Größe")\r\n'),
    'notes.txt': Buffer.from('Synthetic notes\r\n'),
    'unknown.asset': Buffer.from([255, 128, 0, 42]),
  };
  for (const [name, bytes] of Object.entries(originals)) writeFileSync(join(root, name), bytes);
  const files = listTree(root).files;
  const reread = readRelFiles(root, Object.keys(originals)).files;
  for (const [name, bytes] of Object.entries(originals)) {
    assert.ok(sameBytes(bytes, fileBytes(files[name])), `Tree changed bytes of ${name}`);
    assert.ok(sameBytes(bytes, fileBytes(reread[name])), `Targeted reload changed bytes of ${name}`);
  }
  const snapshotPath = join(root, 'jobs', 'latest.json');
  const makeHost = () => new AgentJobHost({ snapshotPath, runtime: new AgentProjectRuntime(), launch() {
    const child = new EventEmitter(); child.send = () => {}; child.kill = () => {}; return child;
  } });
  const request = { project: root, execution: true, writeThrough: true, files, model: { model: 'no-inference-fixture' }, messages: [{ role: 'user', content: 'Synthetic controlled resume' }] };
  const first = makeHost(); t.after(() => first.close());
  first.start(request); first.child.emit('message', { type: 'ready' });
  first.stop(); const id = first.state.id;
  await first.close();
  const restored = makeHost(); t.after(() => restored.close());
  assert.equal(restored.state.status, 'stopped');
  restored.resume(id, request);
  assert.equal(restored.state.resumedFrom, id);
  assert.equal(restored.state.status, 'starting');
  assert.ok(readFileSync(join(root, 'jobs', 'history', id + '.json')));
  for (const [name, bytes] of Object.entries(originals)) assert.deepEqual(readFileSync(join(root, name)), bytes, 'Resume never rewrites source assets');
  await restored.close();
  // Correct encoding must not weaken real edit-conflict protection.
  writeFileSync(join(root, 'Stage.FCStd'), Buffer.from([0x50, 0x4b, 0, 10]));
  const runtime = new AgentProjectRuntime(); t.after(() => runtime.close());
  assert.throws(() => runtime.begin(request, 'real-conflict'), /unterscheiden sich/);
  writeFileSync(join(root, 'notes.txt'), 'External edit');
  assert.throws(() => runtime.begin({ ...request, files: { 'notes.txt': files['notes.txt'] } }, 'text-conflict'), /unterscheiden sich/);
});
