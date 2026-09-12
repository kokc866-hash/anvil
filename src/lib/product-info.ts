import release from "../../product-release.json";

export function publicHttpsUrl(value: string): string | null {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

export const productInfo = {
  publisher: release.publisher.trim(),
  supportUrl: publicHttpsUrl(release.supportUrl),
  licenseName: release.license.name.trim(),
  licenseUrl: publicHttpsUrl(release.license.url),
  signingConfigured: Boolean(release.signing.subjectName.trim()),
};

export const publicationConfigured = Boolean(productInfo.publisher && productInfo.supportUrl && productInfo.licenseName && productInfo.licenseUrl && productInfo.signingConfigured);
