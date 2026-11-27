import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import electron from 'electron';
import { build } from 'vite';

test('preview first capture waits for delayed initial rendering in real Chromium', { timeout: 50000 }, async () => {
 const base = resolve('artifacts/completion-plan-preview-2026-10-29/preview');
 mkdirSync(base, { recursive: true });
 const root = mkdtempSync(join(base, 'readiness-'));
 const bundle = await build({ configFile: false, publicDir: false, logLevel: 'silent', resolve: { alias: { '@': resolve('src') } }, build: { ssr: 'src/agent-runtime/preview-runtime.ts', write: false, minify: false } });
 const output = (Array.isArray(bundle) ? bundle : [bundle]).flatMap(value => value.output).find(value => value.type === 'chunk' && value.isEntry);
 writeFileSync(join(root, 'preview-runtime.mjs'), output.code);
 const env = { ...process.env, ANVIL_PREVIEW_QA_ROOT: root };
 delete env.ELECTRON_RUN_AS_NODE;
 const child = spawn(electron, ['scripts/preview-readiness.electron.mjs'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
 let log = '';
 child.stdout.on('data', value => { log += value; });
 child.stderr.on('data', value => { log += value; });
 let timer;
 try {
   const code = await new Promise((resolve, reject) => {
     child.once('error', reject);
     child.once('exit', resolve);
     timer = setTimeout(() => { child.kill(); reject(Error('Preview readiness test timed out')); }, 40000);
   });
   writeFileSync(join(root, 'electron.log'), log);
   assert.ok(existsSync(join(root, 'result.json')), 'Electron did not report (exit ' + code + '): ' + log);
   const result = JSON.parse(readFileSync(join(root, 'result.json'), 'utf8'));
   assert.equal(code, 0, JSON.stringify(result) + '\n' + log.slice(-2000));
   assert.equal(result.ok, true, JSON.stringify(result));
   console.log('Readiness evidence: ' + root);
 } finally {
   clearTimeout(timer);
   if (child.exitCode === null) child.kill();
 }
});

