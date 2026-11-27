import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { listTree, listWorkspaceResults, workspaceResultDestination } from '../companion/git.mjs';
import { createNativeWorkspace, scanBoundWorkspaceResults } from '../electron/native-workspace.mjs';
import { agentLoopFixture, tool } from '../fixtures/agent-loop-fixture.mjs';

function fixture(t) {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), 'anvil-program-output-')));
  assert.equal(path.dirname(home), realpathSync(tmpdir()));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const root = path.join(home, 'project');
  mkdirSync(root);
  return { home, root };
}

function nativeRequest(workspace, request) {
  return request.action === 'tree' || request.action === 'results' ? workspace.runTree(request) : Promise.resolve(workspace.run(request));
}

test('large native files and new external exports are visible without loading their data', async t => {
  const { home, root } = fixture(t);
  mkdirSync(path.join(root, 'Ergebnis'));
  writeFileSync(path.join(root, 'README.md'), '# Workspace');
  const fixtureBlend = Buffer.alloc(2_146_644, 0x67);
  writeFileSync(path.join(root, 'Ergebnis', 'Robot.blend'), fixtureBlend);
  writeFileSync(path.join(root, 'Assembly.FCStd'), Buffer.alloc(10));
  assert.equal(Object.hasOwn(listTree(root).files, 'Ergebnis/Robot.blend'), false, 'legacy text view reproduces the gap');
  const workspace = createNativeWorkspace(home);
  assert.equal((await workspace.runTree({ root, action: 'results' })).ok, false, 'unselected workspace cannot be read');
  workspace.remember(root);
  const first = await workspace.runTree({ root, action: 'results' });
  assert.equal(first.ok, true, first.error);
  assert.deepEqual(first.results.map(({path, size}) => [path, size]).sort(), [
    ['Assembly.FCStd', 10], ['Ergebnis/Robot.blend', fixtureBlend.length],
  ]);
  assert.ok(JSON.stringify(first).length < 1024, 'only paths and metadata reach the renderer');
  writeFileSync(path.join(root, 'Ergebnis', 'scene.glb'), Buffer.alloc(64));
  const stat = lstatSync(root, { bigint: true });
  const next = await scanBoundWorkspaceResults(root, `${stat.dev}:${stat.ino}`);
  assert.equal(next.ok, true, next.error);
  assert.ok(next.results.some(file => file.path === 'Ergebnis/scene.glb'));
  assert.equal((await scanBoundWorkspaceResults(root, '0:0')).ok, false, 'a replaced workspace is rejected');
  assert.equal(workspace.run({ root, action: 'resultReveal', path: 'Ergebnis/scene.glb' }).path, path.join(root, 'Ergebnis', 'scene.glb'));
});

test('result directories and destinations remain bound to the workspace', t => {
  const { home, root } = fixture(t);
  assert.equal(workspaceResultDestination(root, 'Robot.blend'), path.join(root, 'Ergebnis', 'Robot.blend'));
  assert.ok(existsSync(path.join(root, 'Ergebnis')));
  assert.ok(!existsSync(path.join(root, 'Ergebnis', 'Robot.blend')), 'path preparation never creates an empty output file');
  assert.equal(workspaceResultDestination(root, 'Assets/park.glb'), path.join(root, 'Assets', 'park.glb'));
  assert.equal(workspaceResultDestination(root, 'Ergebnis/CAD', true), path.join(root, 'Ergebnis', 'CAD'));
  assert.equal(workspaceResultDestination(root, path.join(root, 'Ergebnis', 'Robot.blend')), path.join(root, 'Ergebnis', 'Robot.blend'));
  for (const input of ['../other.blend', path.join(home, 'elsewhere.blend'), '.git/import.blend', 'secrets/output.glb', 'NUL.blend']) {
    assert.throws(() => workspaceResultDestination(root, input));
  }
});

test('sensitive files are omitted from metadata', t => {
  const { root } = fixture(t);
  mkdirSync(path.join(root, 'Ergebnis'));
  writeFileSync(path.join(root, 'Ergebnis', 'private.pem'), 'fake secret');
  assert.deepEqual(listWorkspaceResults(root).results, []);
  assert.deepEqual(listWorkspaceResults(root).entries, []);
});

test('external workspace changes reconcile the editor and both file tools without losing drafts', async t => {
  const { home, root } = fixture(t);
  const original = 'original.blend', fresh = 'fresh.scad', draft = 'draft.txt', moved = 'moved.txt';
  writeFileSync(path.join(root, original), Buffer.from([0, 1, 2]));
  writeFileSync(path.join(root, draft), 'saved content');
  writeFileSync(path.join(root, moved), 'text before move');
  const native = createNativeWorkspace(home);
  native.remember(root);
  const f = await agentLoopFixture(t);
  const { knownWorkspaceResultFiles, readWorkspaceFile, refreshWorkspaceResults, seedWorkspaceResultFiles, useWorkspaceResults, workspaceBufferProtected } =
    await f.server.ssrLoadModule('/src/lib/workspace-results.ts');
  const { captureDiskTarget } = await f.server.ssrLoadModule('/src/lib/disk-sync.ts');
  let overrideIndex;
  globalThis.window.anvilNative = { workspaceDisk: request => request.action === 'results' && overrideIndex
    ? Promise.resolve(overrideIndex) : nativeRequest(native, request) };
  const before = listTree(root).files;
  f.useIde.setState({ workspaceCwd: root, workspaceNative: true, files: { ...before, [draft]: 'edited draft', 'virtual.txt': 'unsaved virtual file' },
    dirty: { [draft]: true }, openPaths: [original, draft], activePath: original });
  seedWorkspaceResultFiles(Object.keys(before));
  const diskTarget = captureDiskTarget(), known = [...knownWorkspaceResultFiles(f.useIde.getState())];

  unlinkSync(path.join(root, original));
  unlinkSync(path.join(root, draft));
  mkdirSync(path.join(root, 'new-folder'));
  renameSync(path.join(root, moved), path.join(root, 'new-folder', moved));
  writeFileSync(path.join(root, fresh), 'cube([1, 2, 3]);');
  overrideIndex = { ...listWorkspaceResults(root), entries: [], truncated: true };
  await refreshWorkspaceResults();
  assert.ok(Object.hasOwn(f.useIde.getState().files, original), 'partial scans never evict cached files');
  overrideIndex = undefined;

  const calls = [tool('read_file', { path: fresh }), tool('list_files', {}), tool('read_file', { path: original }), tool('read_file', { path: draft })];
  const observed = [];
  f.beginAgent();
  await f.runAgentLoop({ messages: [{ role: 'user', content: 'Read the files and list this directory without writing changes.' }],
    files: Object.entries(f.useIde.getState().files).map(([path, content]) => ({ path, content })), workspaceDiskFiles: known,
    runLoop: false, autoRunAgent: false, maxRounds: 10 },
  async () => calls.shift() ?? { content: 'Inspection complete.' }, {
    workspaceResults: refreshWorkspaceResults,
    refreshFile: p => {
      assert.notEqual(p, original, 'removed opaque assets never use file-content reads');
      return readWorkspaceFile(p, diskTarget);
    },
    workspaceBufferProtected,
    onTool: value => observed.push(value),
  });
  assert.match(observed[0].result.content, /cube\(\[1, 2, 3\]\);/, 'direct read works before a full scan');
  assert.deepEqual(observed[1].result.files, [draft, fresh, 'new-folder/moved.txt', 'virtual.txt']);
  assert.deepEqual(observed[1].result.dirs, ['new-folder']);
  assert.match(observed[2].result.error, /not found: original\.blend/);
  assert.equal(observed[3].result.user_changes_protected, true);
  assert.match(observed[3].result.content, /edited draft/);

  const state = f.useIde.getState();
  assert.deepEqual(Object.keys(state.files).sort(), [draft, fresh, 'virtual.txt']);
  assert.equal(state.activePath, draft);
  assert.deepEqual(state.openPaths, [draft]);
  assert.equal(state.dirty[draft], true);
  assert.deepEqual(useWorkspaceResults.getState().index.entries.map(file => file.path).sort(), [fresh, 'new-folder/moved.txt']);
  assert.equal((await readWorkspaceFile('new-folder/moved.txt', diskTarget, true)).content, 'text before move');
  assert.equal(f.useIde.getState().activePath, 'new-folder/moved.txt');
  f.useIde.setState({ workspaceEpoch: state.workspaceEpoch + 1 });
  await assert.rejects(() => readWorkspaceFile(fresh, diskTarget), /gewechselt/);
});

test('a foreground run cannot recreate an externally deleted source from a stale edit or append', async t => {
  const { home, root } = fixture(t);
  const removed = 'removed.txt', changed = 'changed.txt', fresh = 'new.txt';
  writeFileSync(path.join(root, removed), 'original');
  writeFileSync(path.join(root, changed), 'old version');
  const native = createNativeWorkspace(home);
  native.remember(root);
  const f = await agentLoopFixture(t);
  globalThis.window.anvilNative = { workspaceDisk: request => nativeRequest(native, request) };
  const { captureDiskTarget, flushDiskSync } = await f.server.ssrLoadModule('/src/lib/disk-sync.ts');
  const { applyWorkspace } = await f.server.ssrLoadModule('/src/lib/chat-session.ts');
  const { readWorkspaceFile, refreshWorkspaceResults, seedWorkspaceResultFiles, verifyWorkspaceEditBase } =
    await f.server.ssrLoadModule('/src/lib/workspace-results.ts');
  const files = listTree(root).files;
  f.useIde.setState({ workspaceCwd: root, workspaceNative: true, files, autoAcceptDiffs: true });
  seedWorkspaceResultFiles(Object.keys(files));
  const diskTarget = captureDiskTarget(), observed = [];
  const calls = [
    tool('list_files', {}),
    tool('edit_file', { path: removed, old_string: 'original', new_string: 'stale edit' }),
    tool('append_file', { path: removed, content: 'stale append' }),
    tool('edit_file', { path: changed, old_string: 'old version', new_string: 'stale edit' }),
    tool('write_file', { path: fresh, content: 'intentionally created' }),
  ];
  f.beginAgent();
  await f.runAgentLoop({ messages: [{ role: 'user', content: 'Edit the existing notes and write a new note.' }],
    files: Object.entries(files).map(([path, content]) => ({ path, content })), workspaceDiskFiles: Object.keys(files),
    runLoop: false, autoRunAgent: false, maxRounds: 12 }, async () => {
    if (calls.length === 5) {
      unlinkSync(path.join(root, removed));
      writeFileSync(path.join(root, changed), 'external revision');
    }
    return calls.shift() ?? { content: 'Done reviewing the changes.' };
  }, {
    workspaceResults: refreshWorkspaceResults,
    refreshFile: p => readWorkspaceFile(p, diskTarget),
    verifyEditBase: (p, expected) => verifyWorkspaceEditBase(p, expected, diskTarget),
    onWorkspace: applyWorkspace,
    onTool: value => observed.push(value),
  });
  await flushDiskSync();
  assert.deepEqual(observed[0].result.files, [changed]);
  assert.deepEqual(observed.slice(1, 4).map(({result}) => result.fileConflict), [
    { path: removed, kind: 'deleted' }, { path: removed, kind: 'deleted' }, { path: changed, kind: 'changed' },
  ], JSON.stringify(observed));
  assert.equal(existsSync(path.join(root, removed)), false);
  assert.equal(Object.hasOwn(f.useIde.getState().files, removed), false);
  assert.equal(readFileSync(path.join(root, changed), 'utf8'), 'external revision');
  assert.equal(readFileSync(path.join(root, fresh), 'utf8'), 'intentionally created');
  await assert.rejects(() => applyWorkspace({ op: 'write', path: changed, content: 'stale', expectedEditor: 'old version' }), /aktuelle Fassung/);
  assert.equal(f.useIde.getState().files[changed], 'external revision');
});

test('scan and saving do not traverse linked folders', t => {
  const { home, root } = fixture(t);
  const outside = path.join(home, 'other');
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'outside.blend'), Buffer.alloc(20));
  mkdirSync(path.join(root, 'Ergebnis'));
  try {
    symlinkSync(outside, path.join(root, 'Ergebnis', 'redirect'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    t.skip('The current environment denies file links.');
    return;
  }
  assert.deepEqual(listWorkspaceResults(root).results, []);
  assert.throws(() => workspaceResultDestination(root, 'Ergebnis/redirect/copy.blend'), /Verknüpfung/);
  assert.ok(!existsSync(path.join(outside, 'copy.blend')));
});
