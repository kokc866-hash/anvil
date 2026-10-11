import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { refreshPath } from './install.mjs';
import { resolveBin } from './toolchain.mjs';

it('Windows discovers an updated Python beside the old version and uses its executable', { skip: process.platform !== 'win32' }, () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'anvil-python-path-'));
  const programs = path.join(fixture, 'Programs', 'Python');
  const old = path.join(programs, 'Python312');
  const updated = path.join(programs, 'Python314');
  const incomplete = path.join(programs, 'Python315');
  const aliases = path.join(fixture, 'Microsoft', 'WindowsApps');
  for (const dir of [old, updated, incomplete, aliases]) mkdirSync(dir, { recursive: true });
  for (const dir of [old, updated]) writeFileSync(path.join(dir, 'python.exe'), 'fixture');
  writeFileSync(path.join(aliases, 'python3.exe'), 'store alias');
  const previousPath = process.env.PATH;
  const previousLocal = process.env.LOCALAPPDATA;
  try {
    process.env.LOCALAPPDATA = fixture;
    process.env.PATH = `${aliases};${old}`;
    refreshPath();
    assert.equal(resolveBin('python'), path.join(updated, 'python.exe'));
    assert.ok(process.env.PATH.includes(old), 'the old interpreter stays available');
    assert.ok(!process.env.PATH.split(path.delimiter).includes(incomplete), 'an unfinished install is not selected');
  } finally {
    process.env.PATH = previousPath;
    if (previousLocal === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocal;
  }
});
