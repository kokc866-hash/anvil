import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assetName, updateUrl, verifyDigest, assertEmptyDestination } from '../electron/update-safety.mjs';
test('update paths cannot escape their download folder or release origin', () => {
  for (const name of ['../Anvil.exe', 'C:\\Anvil.exe', '/tmp/a.zip', 'a.exe:payload', 'a..exe']) assert.throws(() => assetName(name));
  assert.equal(assetName('Anvil Setup 1.3.24.exe'), 'Anvil Setup 1.3.24.exe');
  assert.throws(() => updateUrl('https://evil.test/file.exe'));
  assert.throws(() => updateUrl('https://github.com/other/anvil/releases/download/a/b.exe'));
  assert.match(updateUrl('https://github.com/kokc866-hash/anvil/releases/download/v1/a.exe'), /^https:/);
});
test('download integrity and empty destination protect existing files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'anvil-update-test-'));
  try {
    assertEmptyDestination(dir);
    const file = join(dir, 'fixture.exe'); await writeFile(file, 'abc');
    assert.throws(() => assertEmptyDestination(dir), /leeren Ordner/);
    await verifyDigest(file, 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    await assert.rejects(verifyDigest(file, 'sha256:' + '0'.repeat(64)), /stimmt nicht/);
    await assert.rejects(verifyDigest(file, ''), /keine SHA/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
