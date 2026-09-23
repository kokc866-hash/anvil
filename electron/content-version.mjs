// Small deterministic change stamp for stale UI results, not a security hash.
/** @param {string} text */
export function contentVersion(text) {
  let a=2166136261,b=5381;
  for(let n=0;n<text.length;n++){const c=text.charCodeAt(n);a=Math.imul(a^c,16777619);b=Math.imul(b,33)^c;}
  return `${text.length}:${a>>>0}:${b>>>0}`;
}
