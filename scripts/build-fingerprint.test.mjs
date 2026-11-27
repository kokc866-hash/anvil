import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, writeFile, copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { sourceFingerprint, recordBuild, verifyBuild } from './build-fingerprint.mjs';
import { verifyPackageFingerprint, verifyInstallerIdentity } from './verify-package-fingerprint.mjs';
import recordPackageIdentity from './package-identity.mjs';

test('packaging fingerprints reject changed sources, version and compiled payload', async () => {
  const output = path.resolve('artifacts/build-fingerprint-tests'); await mkdir(output, {recursive: true});
  const root = await mkdtemp(path.join(output, 'fixture-'));
  async function write(file, body) {const target = path.join(root, file); await mkdir(path.dirname(target), {recursive: true}); await writeFile(target, body);}
  const pkg = JSON.stringify({version: '1.2.3', devDependencies: {electron: '44.5.1'}});
  await write('package.json', pkg);
  await write('src/app.ts', 'export const version = 1;');
  await write('.output/server/index.mjs', 'export const app = 1;');
  await write('agent-build/worker.mjs', 'export const run = 1;');
  await write('agent-build/obsolete-development-chunk.mjs', 'export const obsolete = 1;');
  const before = await sourceFingerprint(root);
  const manifest = await recordBuild(root, before);
  assert.equal('agent-build/obsolete-development-chunk.mjs' in manifest.output, false, 'Only distributed standalone runtime entries belong to the output fingerprint');
  assert.equal((await verifyBuild(root)).version, '1.2.3');
  await write('src/app.ts', 'export const version = 2;');
  await assert.rejects(verifyBuild(root), /stale/);
  await assert.rejects(recordBuild(root, before), /Sources changed/);
  await write('src/app.ts', 'export const version = 1;');
  await write('agent-build/worker.mjs', 'export const run = 2;');
  await assert.rejects(verifyBuild(root), /content differs/);
  await write('agent-build/worker.mjs', 'export const run = 1;');
  await write('package.json', JSON.stringify({version: '1.2.4'}));
  await assert.rejects(verifyBuild(root), /stale/);
  await write('package.json', pkg);
  await write('ui-build/server/index.mjs', 'export const app = 1;');
  assert.equal((await verifyBuild(root, true)).version, '1.2.3');
  await write('ui-build/server/index.mjs', 'stale copy');
  await assert.rejects(verifyBuild(root, true), /content differs/);
});

test('installed content includes the fingerprinted native bridge and rejects modifications inside the package', async () => {
  const output = path.resolve('artifacts/build-fingerprint-tests'); await mkdir(output, {recursive: true});
  const root = await mkdtemp(path.join(output, 'package-'));
  async function write(file, body) {const target = path.join(root, file); await mkdir(path.dirname(target), {recursive: true}); await writeFile(target, body);}
  await write('package.json', JSON.stringify({version: '1.2.3', devDependencies: {electron: '44.5.1'}}));
  await write('electron/main.mjs', 'export const trustedBridge = 1;');
  await write('companion/server.mjs', 'export const helper = 1;');
  await write('.output/server/index.mjs', 'export const ui = 1;');
  await write('ui-build/server/index.mjs', 'export const ui = 1;');
  await write('agent-build/worker.mjs', 'export const agent = 1;');
  const manifest = await recordBuild(root, await sourceFingerprint(root));
  const packageDirectory = path.join(root, 'packaged-app');
  for (const relative of [...Object.keys(manifest.output), 'build-info.json']) {
    const target = path.join(packageDirectory, relative); await mkdir(path.dirname(target), {recursive: true});
    await copyFile(path.join(root, relative), target);
  }
  assert.equal((await verifyPackageFingerprint(packageDirectory, root)).version, '1.2.3');
  await write('packaged-app/electron/main.mjs', 'export const trustedBridge = 2;');
  await assert.rejects(verifyPackageFingerprint(packageDirectory, root), /Packaged file matches.*electron\/main/);
  await write('packaged-app/electron/main.mjs', 'export const trustedBridge = 1;');
  await write('packaged-app/build-info.json', JSON.stringify({...manifest, runtime: '37.10.3'}));
  await assert.rejects(verifyPackageFingerprint(packageDirectory, root), /exact fresh desktop build manifest/);
});

test('resolved QA identity is recorded without a terminal, contains no credentials and rejects the normal product before installation', async () => {
  const base = path.resolve('artifacts/build-fingerprint-tests'); await mkdir(base, {recursive: true});
  const root = await mkdtemp(path.join(base, 'identity-'));
  async function write(file, body) { const target = path.join(root, file); await mkdir(path.dirname(target), {recursive: true}); await writeFile(target, body); }
  await write('package.json', JSON.stringify({version: '1.2.3', devDependencies: {electron: '44.5.1'}}));
  await write('.output/server/index.mjs', 'export const ui = 1;');
  await write('ui-build/server/index.mjs', 'export const ui = 1;');
  await write('agent-build/worker.mjs', 'export const agent = 1;');
  const manifest = await recordBuild(root, await sourceFingerprint(root));
  const outDir = path.join(root, 'packages'), appOutDir = path.join(outDir, 'win-unpacked');
  for (const relative of [...Object.keys(manifest.output), 'build-info.json']) {
    const target = path.join(appOutDir, 'resources', 'app', relative); await mkdir(path.dirname(target), {recursive: true}); await copyFile(path.join(root, relative), target);
  }
  await assert.rejects(verifyInstallerIdentity(outDir, 'AnvilInstallerQA.exe', root), /ENOENT/);
  const appInfo = {id: 'app.anvil.ide', productName: 'Anvil', productFilename: 'Anvil', version: '1.2.3'};
  const context = {electronPlatformName: 'win32', outDir, appOutDir, packager: {projectDir: root, appInfo, config: {cscKeyPassword: 'never-record', cscLink: 'secret-certificate', publish: {token: 'secret-token'}}}};
  await recordPackageIdentity(context);
  await assert.rejects(verifyInstallerIdentity(outDir, 'AnvilInstallerQA.exe', root), /separate Windows registration identity/);
  Object.assign(appInfo, {id: 'app.anvil.installerqa', productName: 'AnvilInstallerQA', productFilename: 'AnvilInstallerQA'});
  await recordPackageIdentity(context);
  const identity = await verifyInstallerIdentity(outDir, 'AnvilInstallerQA.exe', root);
  assert.deepEqual(Object.keys(identity).sort(), ['schema', 'appId', 'productName', 'executable', 'version', 'source', 'outputFingerprint', 'runtime'].sort());
  assert.doesNotMatch(await readFile(path.join(outDir, 'package-identity.json'), 'utf8'), /never-record|secret-certificate|secret-token/);
  await assert.rejects(verifyInstallerIdentity(outDir, 'Anvil.exe', root), /own executable/);
  await write('package.json', JSON.stringify({version: '1.2.4'}));
  await assert.rejects(verifyInstallerIdentity(outDir, 'AnvilInstallerQA.exe', root), /stale/);
});
