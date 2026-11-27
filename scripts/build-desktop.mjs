import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceFingerprint, recordBuild } from './build-fingerprint.mjs';
import { exitStatusFromChild } from './with-app-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A desktop build has no account/database deployment side effects, regardless of the caller's environment.
const env = { ...process.env, ANVIL_ELECTRON_BUILD: '1', VITE_AUTH_ENABLED: 'false', DATABASE_URL: '' };
function run(file, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, file), ...args], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => exitStatusFromChild(code, signal) === 0 ? resolve() : reject(Error(`Desktop build step failed: ${file} (${signal || code})`)));
  });
}
try {
  await run('scripts/build-skill-library.mjs');
  const source = await sourceFingerprint(root);
  await run('scripts/with-app-env.mjs', ['./node_modules/vite/bin/vite.js', 'build']);
  await run('scripts/build-agent-runtime.mjs');
  await recordBuild(root, source);
  await run('scripts/pack-ui.mjs');
  if (process.argv.includes('--package')) {
    const pkg = JSON.parse(await readFile(path.join(root, 'node_modules/electron-builder/package.json'), 'utf8'));
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin['electron-builder'];
    await run(path.join('node_modules/electron-builder', bin), ['--win', 'nsis', 'zip', '--publish', 'never', ...process.argv.slice(2).filter(arg => arg !== '--package')]);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
