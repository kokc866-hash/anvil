import { createHash } from 'node:crypto';
import { createReadStream, readdirSync } from 'node:fs';

export function assetName(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._ -]*\.(exe|zip)$/i.test(name) || name.includes('..')) throw new Error('Ungueltiger Update-Dateiname.');
  return name;
}
export function updateUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== 'github.com' || !u.pathname.startsWith('/kokc866-hash/anvil/releases/download/') || u.username || u.password) throw new Error('Update stammt nicht aus Anvils Release-Verzeichnis.');
  return u.href;
}
export async function verifyDigest(file, digest) {
  if (!/^sha256:[a-f0-9]{64}$/i.test(digest)) throw new Error('Release liefert keine SHA-256-Pruefsumme. Download wird nicht gestartet.');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== digest.slice(7).toLowerCase()) throw new Error('Update-Pruefsumme stimmt nicht. Datei wird nicht geoeffnet.');
}
export function assertEmptyDestination(dir) {
  if (readdirSync(dir).length) throw new Error('Bitte einen leeren Ordner waehlen. Vorhandene Anwendungen und Dateien werden nicht ueberschrieben.');
}
