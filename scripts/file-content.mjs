/** Workspace binary assets are represented as data URLs in memory, and as bytes on disk. */
/** Decode only reversible UTF-8. Preserve archives and other binary data as bytes.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function fileContent(bytes) {
  try {
    // Keep the BOM: removing it would also create a false disk/editor conflict.
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (!text.includes('\0')) return text;
  } catch { /* Binary content must never pass through lossy text decoding. */ }
  let binary = '';
  for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return `data:application/octet-stream;base64,${btoa(binary)}`;
}

/** @param {string} content */
export function fileBytes(content) {
  const text = String(content);
  const image = /^data:((?:image\/[^;,]+)|application\/octet-stream)((?:;[^,]*)?),(.*)$/s.exec(text);
  if (!image) return new TextEncoder().encode(text);
  if (image[2].split(";").includes("base64")) return Uint8Array.from(atob(image[3]), (c) => c.charCodeAt(0));
  return new TextEncoder().encode(decodeURIComponent(image[3]));
}

/** @param {Uint8Array} a @param {Uint8Array} b */
export function sameBytes(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
