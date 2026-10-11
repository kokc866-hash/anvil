import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, lstat} from 'node:fs/promises';
import path from 'node:path';
import {verifyBuild} from './build-fingerprint.mjs';

/** Verify the actual installed/extracted content against this run's fresh desktop build. */
export async function verifyPackageFingerprint(directory, sourceRoot = process.cwd()) {
  const expected = await verifyBuild(sourceRoot, true);
  const manifest = JSON.parse(await readFile(path.join(directory, 'build-info.json'), 'utf8'));
  assert.deepEqual(manifest, expected, 'Package contains the exact fresh desktop build manifest');
  for (const [relative, hash] of Object.entries(expected.output)) {
    const file = path.resolve(directory, relative);
    assert.ok(file.startsWith(path.resolve(directory) + path.sep), 'Fingerprint path stays inside the package');
    const info = await lstat(file);
    assert.ok(info.isFile() && !info.isSymbolicLink(), `Packaged file is regular: ${relative}`);
    assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), hash, `Packaged file matches the fresh build: ${relative}`);
  }
  return expected;
}

/** A local QA installer may never register or replace the normal Anvil product. */
export async function verifyInstallerIdentity(directory, executable, sourceRoot = process.cwd()) {
  const manifest = await verifyBuild(sourceRoot, true);
  const identity = JSON.parse(await readFile(path.join(directory, 'package-identity.json'), 'utf8'));
  assert.equal(identity.schema, 1, 'Package identity proof is present');
  assert.equal(identity.appId, 'app.anvil.installerqa', 'QA package must have a separate Windows registration identity');
  assert.equal(identity.productName, 'AnvilInstallerQA', 'QA package must have a separate product name');
  assert.equal(identity.executable, executable, 'QA package must use its own executable');
  assert.equal(identity.version, manifest.version);
  assert.equal(identity.source, manifest.source, 'Identity belongs to the current fresh source build');
  assert.equal(identity.outputFingerprint, manifest.outputFingerprint, 'Identity belongs to the checked package content');
  assert.equal(identity.runtime, manifest.runtime);
  return identity;
}
