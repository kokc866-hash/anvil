import assert from 'node:assert/strict';
import { test } from 'node:test';
import { worktreeActionProblem, worktreeIsCurrent, worktreeRootsOverlap, withWorktreeProjectLease, type ManagedWorktree } from './worktrees.ts';

const worktree: ManagedWorktree = { id: 'test', name: 'Task', path: 'I:\\managed\\task', source: 'I:\\project', baseRevision: 'abc', baseBranch: 'main', branch: 'anvil/task-test', createdAt: 1, state: 'ready' };
const idle = { agentBusy: false, pathOperation: null, dirty: {} };

test('root comparisons respect Windows identity and directory boundaries', () => {
  assert.equal(worktreeRootsOverlap('I:\\Project', 'i:/project/src'), true);
  assert.equal(worktreeRootsOverlap('I:\\Project', 'I:/project-two'), false);
  assert.equal(worktreeRootsOverlap('/work/A', '/work/a'), false);
  assert.equal(worktreeRootsOverlap('', ''), false);
  assert.equal(worktreeIsCurrent(worktree, 'i:/managed/task/'), true);
});

test('active tasks and unsaved edits block workspace changes, read-only comparison remains available', () => {
  assert.match(worktreeActionProblem('open', { ...idle, agentBusy: true }), /Vordergrundauftrag/);
  assert.equal(worktreeActionProblem('compare', { ...idle, agentBusy: true }), '');
  assert.match(worktreeActionProblem('integrate', { ...idle, dirty: { 'a.ts': true } }), /speichern/);
  assert.match(worktreeActionProblem('open', { ...idle, pendingDiffs: [{}] }), /abgleichen/);
  assert.equal(worktreeActionProblem('create', { ...idle, dirty: { 'a.ts': true } }), '');
  assert.match(worktreeActionProblem('remove', idle, worktree, worktree.path), /Hauptprojekt/);
  assert.match(worktreeActionProblem('remove', idle, { ...worktree, dirty: true }, worktree.source), /bleibt erhalten/);
});

test('native project lease releases only after the operation settles, including failure', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window'), calls: { action: string; payload: unknown }[] = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { anvilNative: { agentJob: async (action: string, payload: unknown) => { calls.push({ action, payload }); return { leaseId: 'lease' }; } } } });
  try {
    await assert.rejects(withWorktreeProjectLease([worktree.source, worktree.path], async () => { assert.equal(calls.length, 1); throw Error('Synthetic operation failed'); }), /Synthetic/);
    assert.deepEqual(calls.map(c => c.action), ['workspace-acquire', 'workspace-release']);
    assert.deepEqual((calls[0].payload as { projects: string[] }).projects, [worktree.source, worktree.path]);
    assert.equal((calls[0].payload as { owner: string }).owner, (calls[1].payload as { owner: string }).owner);
  } finally { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); }
});
