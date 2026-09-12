import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function releaseReadiness(config) {
  const missing = [];
  const text = value => typeof value === 'string' && value.trim().length > 0 && !/^(todo|tbd|placeholder)$/i.test(value.trim());
  const url = value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !/(^|\.)(example\.(com|org|net)|localhost)$/.test(u.hostname); } catch { return false; } };
  if (!text(config?.publisher)) missing.push('Herausgeber (publisher)');
  if (!url(config?.supportUrl)) missing.push('Support-Adresse (supportUrl, HTTPS)');
  if (!text(config?.license?.name) || !url(config?.license?.url)) missing.push('Nutzungsrahmen (license.name und license.url)');
  if (!text(config?.signing?.subjectName)) missing.push('Signatur-Herausgeber (signing.subjectName)');
  return missing;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(readFileSync(new URL('../product-release.json', import.meta.url), 'utf8'));
  const missing = releaseReadiness(config);
  if (missing.length) {
    console.error(`Signierte Freigabe noch nicht moeglich: ${missing.join('; ')}. Ausdruecklich gestartete unsignierte Releases bleiben moeglich.`);
    process.exitCode = 1;
  } else console.log('Release-Angaben vollstaendig. Signatur und Paketabnahme werden separat geprueft.');
}
