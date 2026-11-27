import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyPackageFingerprint } from './verify-package-fingerprint.mjs';

/** Record the actual resolved Windows identity, including CLI overrides, even without a TTY. */
export default async function recordPackageIdentity(context) {
  if (context.electronPlatformName !== 'win32') return;
  const manifest = await verifyPackageFingerprint(path.join(context.appOutDir, 'resources', 'app'), context.packager.projectDir);
  const identity = {
    schema: 1,
    appId: context.packager.appInfo.id,
    productName: context.packager.appInfo.productName,
    executable: `${context.packager.appInfo.productFilename}.exe`,
    version: context.packager.appInfo.version,
    source: manifest.source,
    outputFingerprint: manifest.outputFingerprint,
    runtime: manifest.runtime,
  };
  // An allowlist avoids recording credentials from the signing/publishing configuration.
  await mkdir(context.outDir, { recursive: true });
  await writeFile(path.join(context.outDir, 'package-identity.json'), JSON.stringify(identity, null, 2) + '\n');
}
