import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { crc32, createInflate } from 'node:zlib';
import { validWorkspaceResultPath } from '../scripts/workspace-results.mjs';
import { isSecretPath } from './agent-secret-path.mjs';

const maxBytes = 512 * 1024 * 1024;
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
const pngDepths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const pngChannels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const adam7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
const blockSize = 256 * 1024;
const validDimension = value => Number.isInteger(value) && value > 0 && value <= 0x7fffffff;

function versionFor(stat) {
  return createHash('sha256').update([stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':')).digest('hex');
}

async function locate(root, identity, relative) {
  const rootStat = await lstat(root, { bigint: true });
  if (!rootStat.isDirectory() || `${rootStat.dev}:${rootStat.ino}` !== identity) {
    throw new Error('Der Projektordner wurde ausgetauscht.');
  }
  let full = root;
  let stat = rootStat;
  for (const segment of relative.split('/')) {
    if (!stat.isDirectory()) throw new Error('Pfad im Projektordner ungültig.');
    full = join(full, segment);
    stat = await lstat(full, { bigint: true });
    if (stat.isSymbolicLink()) throw new Error('Verknüpfungen werden bei der Dateiprüfung nicht verfolgt.');
  }
  if (!stat.isFile()) throw new Error('Der Pfad verweist auf keine reguläre Datei.');
  return { full, stat };
}

async function pngDimensions(read, remaining, signal) {
  const invalid = () => new Error('PNG-Dateistruktur oder Bilddaten ungültig.');
  if (remaining() < 57 || !(await read(8)).equals(pngSignature)) throw invalid();
  let width, height, expectedBytes, pixelBytes = 0;
  let idatStarted = false, idatEnded = false;
  await pipeline(async function* chunks() {
    for (let i = 0; i < 65536 && remaining() >= 12; i++) {
      const prefix = await read(8);
      let length = prefix.readUInt32BE(0);
      const type = prefix.toString('latin1', 4);
      if (!/^[A-Za-z]{4}$/.test(type) || length > remaining() - 4 || (type === 'IHDR') !== (i === 0)) throw invalid();
      let checksum = crc32(prefix.subarray(4));
      if (type === 'IHDR') {
        if (length !== 13) throw invalid();
        const header = await read(length);
        checksum = crc32(header, checksum);
        width = header.readUInt32BE(0); height = header.readUInt32BE(4);
        const [depth, color, compression, filter, interlace] = header.subarray(8, 13);
        if (!validDimension(width) || !validDimension(height) || !pngDepths[color]?.includes(depth)
          || compression !== 0 || filter !== 0 || interlace > 1) throw invalid();
        const bits = depth * pngChannels[color];
        let total = 0;
        for (const [x, y, dx, dy] of interlace ? adam7 : [[0, 0, 1, 1]]) {
          const columns = Math.ceil((width - x) / dx);
          const rows = Math.ceil((height - y) / dy);
          if (columns > 0 && rows > 0) total += (Math.ceil(columns * bits / 8) + 1) * rows;
        }
        if (total > maxBytes) throw new Error('Entpackte PNG-Bilddaten überschreiten 512 MiB.');
        expectedBytes = total;
      } else {
        if (type === 'IEND' && length !== 0 || type === 'IDAT' && idatEnded) throw invalid();
        idatEnded ||= idatStarted && type !== 'IDAT';
        idatStarted ||= type === 'IDAT';
        while (length) {
          const data = await read(Math.min(blockSize, length));
          length -= data.length;
          checksum = crc32(data, checksum);
          if (type === 'IDAT') yield data;
        }
      }
      if ((await read(4)).readUInt32BE(0) !== checksum) throw invalid();
      if (type === 'IEND') {
        if (!idatStarted || remaining() !== 0) throw invalid();
        return;
      }
    }
    throw invalid();
  }, createInflate(), async function decoded(pixels) {
    for await (const bytes of pixels) {
      pixelBytes += bytes.length;
      if (pixelBytes > expectedBytes) throw invalid();
    }
  }, { signal }).catch(error => {
    if (typeof error.code === 'string' && error.code.startsWith('Z_')) throw invalid();
    throw error;
  });
  if (pixelBytes !== expectedBytes) throw invalid();
  return { width, height };
}

export async function verifyWorkspaceFile(root, identity, request, signal) {
  const { path, width, height, versionOnly } = request;
  const fail = (error, details = {}) => ({ ok: false, error, ...details });
  if (typeof path !== 'string' || !validWorkspaceResultPath(path) || isSecretPath(path)) return fail('Ungültiger Projektpfad für die Dateiprüfung.');
  const png = /\.png$/i.test(path);
  if (width !== undefined && !validDimension(width) || height !== undefined && !validDimension(height)
    || !png && (width !== undefined || height !== undefined)) {
    return fail('Bildabmessungen müssen positive Ganzzahlen sein und können nur für PNG-Dateien geprüft werden.');
  }
  let file;
  try {
    signal?.throwIfAborted();
    const { full, stat } = await locate(root, identity, path);
    const version = versionFor(stat);
    const size = Number(stat.size);
    if (versionOnly === true) return { ok: true, path, size, version };
    if (size > maxBytes) return fail('Datei ist größer als 512 MiB. Eine Prüfsumme konnte nicht ermittelt werden.', { path, size });
    file = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || versionFor(before) !== version) throw new Error('Datei wurde während der Prüfung geändert.');
    const hash = createHash('sha256');
    let offset = 0;
    const read = async length => {
      const buffer = Buffer.allocUnsafe(length);
      let readBytes = 0;
      while (readBytes < length) {
        signal?.throwIfAborted();
        const { bytesRead } = await file.read(buffer, readBytes, length - readBytes, offset);
        if (!bytesRead) throw new Error('Datei wurde während der Prüfung gekürzt.');
        readBytes += bytesRead;
        offset += bytesRead;
      }
      hash.update(buffer);
      return buffer;
    };
    const dimensions = png ? await pngDimensions(read, () => size - offset, signal) : {};
    while (offset < size) await read(Math.min(blockSize, size - offset));
    const current = await locate(root, identity, path);
    if (offset !== size || versionFor(await file.stat({ bigint: true })) !== version || versionFor(current.stat) !== version) {
      throw new Error('Datei wurde während der Prüfung geändert.');
    }
    if (width !== undefined && width !== dimensions.width || height !== undefined && height !== dimensions.height) {
      return fail('PNG-Abmessungen stimmen nicht mit dem Sollwert überein.', { path, size, ...dimensions });
    }
    return { ok: true, path, size, sha256: hash.digest('hex'), version, ...dimensions };
  } catch (error) {
    signal?.throwIfAborted();
    if (error.code === 'ENOENT') return fail('Datei im Projektordner nicht gefunden.', { path });
    if (error.code) return fail('Datei im Projektordner konnte nicht gelesen werden.', { path });
    return fail(error.message, { path });
  } finally {
    await file?.close();
  }
}
