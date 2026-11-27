import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, renameSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ManagedWorktrees, runWorktreeProcess } from './worktrees.mjs';

const home = path.resolve('artifacts/cursor-adoption-2026-10-19/worktrees');
mkdirSync(home, { recursive: true });
function fixture() {
  const area = mkdtempSync(path.join(home, 'case-'));
  const repo = path.join(area, 'main'); mkdirSync(repo);
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'core.hooksPath=', ...args], { cwd: repo, encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  git('init'); git('config', 'user.name', 'Anvil isolated test'); git('config', 'user.email', 'isolated@example.invalid');
  writeFileSync(path.join(repo, 'one.txt'), 'base one\n'); writeFileSync(path.join(repo, 'two.txt'), 'base two\n');
  git('add', '.'); git('commit', '-m', 'Synthetic base');
  const storage = path.join(area, 'managed');
  return { area, repo, git, storage, manager: new ManagedWorktrees({ storage }), clean: () => { assert.equal(path.dirname(path.resolve(area)), home); rmSync(area, { recursive: true, force: true }); } };
}

test('managed worktree starts at persisted HEAD, preserves dirty main and survives a new manager', async () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.repo, 'one.txt'), 'foreign dirty\n');
    const before = f.git('status', '--porcelain');
    const index = readFileSync(path.join(f.repo, '.git', 'index'));
    const made = await f.manager.create({ cwd: f.repo, name: 'Isolated task' });
    assert.equal(made.ok, true); assert.match(made.worktree.branch, /^anvil\/task-/);
    assert.equal(readFileSync(path.join(made.worktree.path, 'one.txt'), 'utf8'), 'base one\n');
    assert.equal(f.git('status', '--porcelain'), before);
    assert.deepEqual(readFileSync(path.join(f.repo, '.git', 'index')), index);
    const next = new ManagedWorktrees({ storage: f.storage });
    const list = await next.list({ cwd: f.repo });
    assert.equal(list.worktrees[0].baseRevision, made.worktree.baseRevision);
    assert.equal(list.worktrees[0].id, made.worktree.id);
  } finally { f.clean(); }
});

test('two isolated tasks can change the same relative path; the second return preserves its conflict', async () => {
  const f = fixture();
  try {
    const first = (await f.manager.create({ cwd: f.repo, name: 'First task' })).worktree;
    const second = (await f.manager.create({ cwd: f.repo, name: 'Second task' })).worktree;
    writeFileSync(path.join(first.path, 'one.txt'), 'first task\n');
    writeFileSync(path.join(second.path, 'one.txt'), 'second task\n');
    assert.equal((await f.manager.integrate({ cwd: f.repo, id: first.id })).ok, true);
    const blocked = await f.manager.integrate({ cwd: f.repo, id: second.id });
    assert.equal(blocked.ok, false); assert.deepEqual(blocked.conflicts.map(c => c.path), ['one.txt']);
    assert.equal(readFileSync(path.join(f.repo, 'one.txt'), 'utf8'), 'first task\n');
    assert.equal(readFileSync(path.join(second.path, 'one.txt'), 'utf8'), 'second task\n');
    const recovered = new ManagedWorktrees({ storage: f.storage });
    assert.deepEqual((await recovered.compare({ cwd: second.path, id: second.id })).conflicts, blocked.conflicts);
  } finally { f.clean(); }
});

test('dirty source, untracked binary and rename return without changing foreign dirty main or its index', async () => {
  const f = fixture();
  try {
    const { worktree: w } = await f.manager.create({ cwd: f.repo });
    writeFileSync(path.join(f.repo, 'two.txt'), 'foreign work\n'); f.git('add', 'two.txt');
    const index = f.git('diff', '--cached');
    renameSync(path.join(w.path, 'one.txt'), path.join(w.path, 'renamed.txt'));
    writeFileSync(path.join(w.path, 'renamed.txt'), 'changed isolated\n');
    writeFileSync(path.join(w.path, 'binary.dat'), Buffer.from([0, 254, 13, 10, 200]));
    const comparison = await f.manager.compare({ cwd: f.repo, id: w.id });
    assert.equal(comparison.changes.length, 3);
    assert.deepEqual(comparison.conflicts, []);
    const result = await f.manager.integrate({ cwd: f.repo, id: w.id, expectedRevision: comparison.revision });
    assert.equal(result.ok, true);
    assert.equal(existsSync(path.join(f.repo, 'one.txt')), false);
    assert.equal(readFileSync(path.join(f.repo, 'renamed.txt'), 'utf8'), 'changed isolated\n');
    assert.deepEqual(readFileSync(path.join(f.repo, 'binary.dat')), Buffer.from([0, 254, 13, 10, 200]));
    assert.equal(readFileSync(path.join(f.repo, 'two.txt'), 'utf8'), 'foreign work\n');
    assert.equal(f.git('diff', '--cached'), index);
    assert.equal(readFileSync(path.join(w.path, 'renamed.txt'), 'utf8'), 'changed isolated\n');
    assert.equal((await f.manager.integrate({ cwd: f.repo, id: w.id })).ok, true);
  } finally { f.clean(); }
});

test('all conflicts are reported and neither side changes, including a foreign untracked destination', async () => {
  const f = fixture();
  try {
    const { worktree: w } = await f.manager.create({ cwd: f.repo });
    writeFileSync(path.join(w.path, 'one.txt'), 'task\n'); writeFileSync(path.join(w.path, 'two.txt'), 'task two\n');
    writeFileSync(path.join(w.path, 'new.txt'), 'new task\n');
    writeFileSync(path.join(f.repo, 'one.txt'), 'other\n'); writeFileSync(path.join(f.repo, 'new.txt'), 'other new\n');
    const before = f.git('status', '--porcelain');
    const result = await f.manager.integrate({ cwd: f.repo, id: w.id });
    assert.equal(result.ok, false);
    assert.deepEqual(result.conflicts.map(c => c.path).sort(), ['new.txt', 'one.txt']);
    assert.equal(readFileSync(path.join(f.repo, 'two.txt'), 'utf8'), 'base two\n');
    assert.equal(readFileSync(path.join(f.repo, 'one.txt'), 'utf8'), 'other\n');
    assert.equal(readFileSync(path.join(w.path, 'one.txt'), 'utf8'), 'task\n');
    assert.equal(f.git('status', '--porcelain'), before);
  } finally { f.clean(); }
});

test('comparison is bound to both sides; cleanup refuses dirty, ignored, committed or foreign checkouts', async () => {
  const f = fixture();
  try {
    const { worktree: w } = await f.manager.create({ cwd: f.repo });
    writeFileSync(path.join(w.path, 'one.txt'), 'first\n');
    const compared = await f.manager.compare({ cwd: f.repo, id: w.id });
    writeFileSync(path.join(w.path, 'one.txt'), 'second\n');
    assert.equal((await f.manager.integrate({ cwd: f.repo, id: w.id, expectedRevision: compared.revision })).ok, false);
    await assert.rejects(f.manager.remove({ cwd: f.repo, id: w.id }), /Änderungen/);
    await assert.rejects(f.manager.remove({ cwd: f.repo, id: '../foreign' }), /registriert|Kennung/);
    writeFileSync(path.join(w.path, 'one.txt'), 'base one\n');
    writeFileSync(path.join(w.path, '.gitignore'), 'kept.bin\n');
    const gw = (...a) => { const r = spawnSync('git', ['-c', 'core.hooksPath=', ...a], { cwd: w.path, windowsHide: true, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
    gw('add', '.'); gw('commit', '-m', 'Synthetic task commit');
    writeFileSync(path.join(w.path, 'kept.bin'), 'keep');
    await assert.rejects(f.manager.remove({ cwd: f.repo, id: w.id }), /Änderungen|Dateien/);
    assert.equal(existsSync(path.join(w.path, 'kept.bin')), true);
  } finally { f.clean(); }
});

test('only clean unmodified own checkouts are removed and branches are retained', async () => {
  const f = fixture();
  try {
    const { worktree: w } = await f.manager.create({ cwd: f.repo });
    assert.equal((await f.manager.remove({ cwd: f.repo, id: w.id })).ok, true);
    assert.equal(existsSync(w.path), false);
    assert.ok(f.git('branch', '--list', w.branch));
    assert.deepEqual((await f.manager.list({ cwd: f.repo })).worktrees, []);
  } finally { f.clean(); }
});

test('hooks and checkout filter commands are never executed', async () => {
  const f = fixture();
  try {
    const marker = path.join(f.area, 'hook-ran').replaceAll('\\', '/');
    const hook = path.join(f.repo, '.git', 'hooks', 'post-checkout');
    writeFileSync(hook, `#!/bin/sh\necho ran > '${marker}'\n`, { mode: 0o755 });
    writeFileSync(path.join(f.repo, '.gitattributes'), '*.txt filter=probe\n');
    f.git('add', '.gitattributes'); f.git('commit', '-m', 'Synthetic attributes');
    f.git('config', 'filter.probe.smudge', `echo filter >> '${marker}'`);
    f.git('config', 'filter.probe.clean', `echo clean >> '${marker}'`);
    const { worktree: w } = await f.manager.create({ cwd: f.repo });
    assert.equal(existsSync(marker), false);
    assert.equal(readFileSync(path.join(w.path, 'one.txt'), 'utf8'), 'base one\n');
  } finally { f.clean(); }
});

test('renamed roots and path traversal are refused', async () => {
  const f = fixture();
  try {
    const { worktree: w } = await f.manager.create({ cwd: f.repo });
    renameSync(w.path, w.path + '-moved');
    await assert.rejects(f.manager.compare({ cwd: f.repo, id: w.id }), /fehlt|verändert|verschoben/);
    await assert.rejects(f.manager.create({ cwd: f.repo, name: '../escape' }), /Name/);
  } finally { f.clean(); }
});

test('symlink destinations are refused without writing outside the target', async t => {
  const f = fixture();
  try {
    const { worktree: w } = await f.manager.create({ cwd: f.repo });
    mkdirSync(path.join(w.path, 'child')); writeFileSync(path.join(w.path, 'child', 'one.txt'), 'task');
    const outside = path.join(f.area, 'outside'); mkdirSync(outside);
    try { symlinkSync(outside, path.join(f.repo, 'child'), process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('Environment does not permit a synthetic junction/symlink.'); return; } throw error; }
    const result = await f.manager.integrate({ cwd: f.repo, id: w.id });
    assert.equal(result.ok, false); assert.equal(result.conflicts[0].path, 'child/one.txt');
    assert.equal(existsSync(path.join(outside, 'one.txt')), false);
  } finally { f.clean(); }
});

test('aborting a process waits for its exit; an aborted create never mutates Git', async () => {
  const f = fixture();
  try {
    const controller = new AbortController();
    const pending = runWorktreeProcess(process.execPath, ['-e', 'setTimeout(()=>{},30000)'], { cwd: f.repo, signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(pending, { name: 'AbortError' });
    const before = f.git('worktree', 'list', '--porcelain');
    await assert.rejects(f.manager.create({ cwd: f.repo, signal: controller.signal }), { name: 'AbortError' });
    assert.equal(f.git('worktree', 'list', '--porcelain'), before);
  } finally { f.clean(); }
});

test('Windows executable-mode changes are visibly blocked instead of silently lost', { skip: process.platform !== 'win32' }, async () => {
  const f = fixture();
  try {
    const { worktree: w } = await f.manager.create({ cwd: f.repo });
    const mode = spawnSync('git', ['update-index', '--chmod=+x', 'one.txt'], { cwd: w.path, encoding: 'utf8', windowsHide: true }); assert.equal(mode.status, 0, mode.stderr);
    const result = await f.manager.integrate({ cwd: f.repo, id: w.id });
    assert.equal(result.ok, false); assert.match(result.conflicts[0].reason, /Dateimod/);
    assert.equal(readFileSync(path.join(f.repo, 'one.txt'), 'utf8'), 'base one\n');
  } finally { f.clean(); }
});
