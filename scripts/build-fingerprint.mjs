import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isMainModule } from './with-app-env.mjs';

const directories = ['src', 'public', 'electron', 'companion', 'scripts', 'build', 'skills'];
const inputs = ['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'product-release.json', '.grok/app-env.json'];
const nativeInputs = ['electron', 'companion', 'public/icon.ico', 'public/icon.png', 'product-release.json', 'scripts/llm-agent.mjs', 'scripts/file-content.mjs', 'scripts/workspace-results.mjs', 'node_modules/typescript/lib'];
// build-agent-runtime writes four standalone entries. Older unused chunks in the
// development directory are deliberately not distributed by electron-builder.
const agentOutputs = ['worker', 'service-contract', 'preview-runtime', 'debug-trace'].map(name => `agent-build/${name}.mjs`);
async function tree(root, relative) {
  let info;
  try { info = await lstat(path.join(root, relative)); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  if (info.isSymbolicLink()) throw Error(`Build input must not be a symbolic link: ${relative}`);
  if (info.isFile()) return [relative.replaceAll('\\', '/')];
  if (!info.isDirectory()) return [];
  const entries = await readdir(path.join(root, relative));
  return (await Promise.all(entries.sort().map(name => tree(root, path.join(relative, name))))).flat();
}
async function hashes(root, files, map = value => value) {
  const entries = [];
  for (const file of files.sort()) entries.push([map(file), createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')]);
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
}
function fingerprint(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
async function builtFiles(root, packed) {
  return [...await tree(root, packed ? 'ui-build' : '.output'),
    ...(await Promise.all(agentOutputs.map(item => tree(root, item)))).flat(),
    ...(await Promise.all(nativeInputs.map(item => tree(root, item)))).flat()]
    .filter(file => !file.endsWith('.map') && !file.endsWith('.test.mjs'));
}
export async function sourceFingerprint(root = process.cwd()) {
  const files = (await Promise.all([...directories, ...inputs].map(item => tree(root, item)))).flat()
    .filter(file => file !== 'src/routeTree.gen.ts' && !file.endsWith('.log'));
  return fingerprint(await hashes(root, files));
}
export async function recordBuild(root = process.cwd(), expectedSource) {
  const source = await sourceFingerprint(root);
  if (expectedSource && source !== expectedSource) throw Error('Sources changed during the desktop build. Build again before packaging.');
  const files = await builtFiles(root, false);
  const output = await hashes(root, files, file => file.replace(/^\.output\//, 'ui-build/'));
  if (!output['ui-build/server/index.mjs'] || !output['agent-build/worker.mjs']) throw Error('Both UI and background runtime must be built.');
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  let commit = null;
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']}).trim(); } catch { /* Source archives need no Git checkout. */ }
  const manifest = { schema: 1, version: pkg.version, commit, source, output, outputFingerprint: fingerprint(output),
    runtime: pkg.devDependencies?.electron, builtAt: new Date().toISOString(), target: 'desktop', auth: false };
  await writeFile(path.join(root, 'build-info.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
export async function verifyBuild(root = process.cwd(), packed = false) {
  const manifest = JSON.parse(await readFile(path.join(root, 'build-info.json'), 'utf8'));
  if (manifest.schema !== 1 || manifest.target !== 'desktop' || manifest.auth !== false) throw Error('Missing or invalid desktop build fingerprint. Use npm run build:desktop.');
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version || manifest.source !== await sourceFingerprint(root)) throw Error('Desktop build is stale for the current sources. Use npm run build:desktop.');
  const files = await builtFiles(root, packed);
  const output = await hashes(root, files, file => file.replace(/^\.output\//, 'ui-build/'));
  if (fingerprint(output) !== manifest.outputFingerprint || fingerprint(manifest.output) !== manifest.outputFingerprint) throw Error('Built content differs from its fingerprint. Rebuild before packaging.');
  return manifest;
}
if (isMainModule(import.meta.url)) {
  const manifest = process.argv.includes('--record') ? await recordBuild() : await verifyBuild(process.cwd(), process.argv.includes('--packed'));
  console.log(`Desktop build ${manifest.version}: ${manifest.source.slice(0, 12)} / ${manifest.outputFingerprint.slice(0, 12)}`);
}
