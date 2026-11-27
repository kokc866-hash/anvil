import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { crc32, deflateSync } from 'node:zlib';
import { verifyWorkspaceFile } from '../electron/workspace-file-proof.mjs';

function chunk(type, data) {
  const prefix = Buffer.alloc(8);
  prefix.writeUInt32BE(data.length);
  prefix.write(type, 4);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc32(data, crc32(prefix.subarray(4))));
  return Buffer.concat([prefix, data, sum]);
}

function png(width, height, compressed = deflateSync(Buffer.alloc((width + 1) * height))) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    ...(compressed === null ? [] : [chunk('IDAT', compressed)]),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('workspace file proof measures the real file, detects changed versions and rejects malformed PNGs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'anvil-file-proof-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stat = await lstat(root, { bigint: true });
  const identity = `${stat.dev}:${stat.ino}`;
  await mkdir(join(root, 'Ergebnis'));
  const path = 'Ergebnis/Ansicht.png';
  await writeFile(join(root, path), png(8, 6));
  const verify = query => verifyWorkspaceFile(root, identity, { path, ...query });
  const first = await verify({ width: 8, height: 6 });
  assert.equal(first.ok, true, first.error);
  assert.equal(first.sha256, createHash('sha256').update(png(8, 6)).digest('hex'));
  assert.equal(first.width, 8);
  assert.equal(first.height, 6);
  assert.deepEqual(await verify({ versionOnly: true }), { ok: true, path, size: first.size, version: first.version });
  const mismatch = await verify({ width: 7, height: 6 });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.width, 8);
  await writeFile(join(root, 'Bericht.md'), 'Geprüft');
  assert.equal((await verify({ versionOnly: true })).version, first.version);
  const invalid = Buffer.from(png(8, 6));
  invalid[44] ^= 1;
  for (const corrupt of [png(8, 6, null), png(8, 6, Buffer.alloc(32, 42)), invalid]) {
    await writeFile(join(root, path), corrupt);
    assert.equal((await verify({ width: 8, height: 6 })).ok, false);
  }
  assert.notEqual((await verify({ versionOnly: true })).version, first.version);
  await rm(join(root, path));
  assert.equal((await verify({ versionOnly: true })).ok, false);
  await writeFile(join(root, 'scene.blend'), 'BLENDER');
  assert.equal((await verify({ path: 'scene.blend' })).ok, true);
  assert.equal((await verify({ path: 'scene.blend', width: 8 })).ok, false);
  assert.equal((await verify({ path: '../scene.blend' })).ok, false);
  assert.equal((await verify({ path: 'C:/scene.blend' })).ok, false);
  assert.equal((await verify({ path: '.env' })).ok, false);
  assert.equal((await verify({ path: 'Ergebnis' })).ok, false);
  await t.test('folder links are rejected before reading the file', async subtest => {
    await writeFile(join(root, path), png(8, 6));
    try {
      await symlink(join(root, 'Ergebnis'), join(root, 'Verweis'), 'junction');
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') return subtest.skip('Symlink creation is unavailable in this sandbox.');
      throw error;
    }
    assert.equal((await verify({ path: 'Verweis/Ansicht.png' })).ok, false);
  });
});
