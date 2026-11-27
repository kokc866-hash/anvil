/** One policy for captured workspace data and explicit native source refresh.
 * @param {string} path */
export function isSecretPath(path) {
  const norm=path.replace(/\\/g,'/'),base=norm.split('/').pop()??'';
  if(/\.env\.(example|sample|template)$/i.test(base))return false;
  if(/(^|\/)\.env($|\.(?!example|sample|template))/i.test(norm))return true;
  if(/(^|\/)(\.git-credentials|id_rsa|credentials)$/i.test(norm))return true;
  if(/\.(pem|p12|pfx)$/i.test(base))return true;
  if(/\.(md|ts|tsx|js|jsx|mjs|cjs|py|go|rs)$/i.test(base))return false;
  if(/^(secrets?|password|token)(\.|$)/i.test(base))return true;
  if(/api[_-]?key/i.test(base))return true;
  return /(^|\/)(secrets?|vault)(\.|\/|$)/i.test(norm);
}
