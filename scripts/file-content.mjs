/** Workspace images are represented as data URLs in memory, and as bytes on disk. */
/** @param {string} content */
export function fileBytes(content) {
  const text = String(content);
  const image = /^data:(image\/[^;,]+)((?:;[^,]*)?),(.*)$/s.exec(text);
  if (!image) return new TextEncoder().encode(text);
  if (image[2].split(";").includes("base64")) return Uint8Array.from(atob(image[3]), (c) => c.charCodeAt(0));
  return new TextEncoder().encode(decodeURIComponent(image[3]));
}

/** @param {Uint8Array} a @param {Uint8Array} b */
export function sameBytes(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
