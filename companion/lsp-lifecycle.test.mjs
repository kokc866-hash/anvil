import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { diagnoseWithLsp } from './lsp.mjs';

function fixture(script) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'anvil-lsp-lifecycle-'));
  const packageDir = path.join(home, 'node_modules', 'anvil-closing-server-fixture');
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ bin: { 'anvil-closing-server-fixture': 'server.mjs' } }));
  writeFileSync(path.join(packageDir, 'server.mjs'), script);
  return { home, spec: { id: 'closing-fixture', kind: 'lsp', bin: 'anvil-closing-server-fixture', npm: ['anvil-closing-server-fixture'], args: [], ext: /\.ts$/, language: () => 'typescript' } };
}

it('a language server closing before didOpen cancels delayed writes and cannot crash the parent', async () => {
  const { home, spec } = fixture('process.stdin.resume(); process.stdin.once("data", () => process.exit(0));');
  const previous = process.env.ANVIL_LSP_HOME;
  process.env.ANVIL_LSP_HOME = home;
  try {
    assert.deepEqual(await diagnoseWithLsp(spec, home, [{ path: 'test.ts', content: 'const value = 1;' }], 3000), []);
    await delay(350); // The former delayed didOpen wrote to a closed pipe here.
  } finally {
    if (previous === undefined) delete process.env.ANVIL_LSP_HOME;
    else process.env.ANVIL_LSP_HOME = previous;
  }
});

it('a diagnostics timeout settles once and leaves no writes queued for a terminated language server', async () => {
  const { home, spec } = fixture('process.stdin.resume();');
  const previous = process.env.ANVIL_LSP_HOME;
  process.env.ANVIL_LSP_HOME = home;
  try {
    assert.deepEqual(await diagnoseWithLsp(spec, home, [{ path: 'test.ts', content: 'const value = 1;' }], 50), []);
    await delay(350);
  } finally {
    if (previous === undefined) delete process.env.ANVIL_LSP_HOME;
    else process.env.ANVIL_LSP_HOME = previous;
  }
});
