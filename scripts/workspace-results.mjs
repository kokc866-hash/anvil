import { hasAsciiControl } from '../electron/text-controls.mjs';

export const WORKSPACE_RESULT_FOLDER = 'Ergebnis';
export const WORKSPACE_TEXT_READ_LIMIT = 1_500_000;

const nativeAsset = /\.(?:blend|fcstd|scad|step|stp|iges|igs|stl|3mf|brep|dxf|dwg|glb|gltf|obj|fbx|usd[acz]?|abc|exr|uasset|umap|unitypackage|unity|tscn|scn|res|tres|png|jpe?g|webp|gif|bmp|tiff?|svg|mp4|webm|mov|wav|flac|mp3|pdf)$/i;
const opaqueAsset = /\.(?:blend|fcstd|3mf|dwg|glb|fbx|usdc|usdz|abc|exr|uasset|umap|unitypackage|scn|res|png|jpe?g|webp|gif|bmp|tiff?|mp4|webm|mov|wav|flac|mp3|pdf)$/i;
const reserved = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;

/** @param {string} path */
export function workspaceResultName(path) {
  return path.toLowerCase().startsWith(`${WORKSPACE_RESULT_FOLDER.toLowerCase()}/`) || nativeAsset.test(path);
}

/** @param {string} path */
export function opaqueWorkspaceResult(path) {
  return opaqueAsset.test(path);
}

/** @param {string} name @param {unknown} [args] */
export function programMaySaveResult(name, args) {
  if (/save|export|render|bake|execute.*(?:code|script|macro)|screenshot|write.*file/i.test(name)) return true;
  if (!args || typeof args !== 'object') return false;
  const action = Reflect.get(args, 'action') ?? Reflect.get(args, 'operation');
  return typeof action === 'string' && /^(?:save(?:_as)?|export|render|bake)$/i.test(action);
}

/** @param {string} path */
export function validWorkspaceResultPath(path) {
  return path.length > 0 && path.length < 512 &&
    path.split('/').every(part => Boolean(part) && part.length <= 255 &&
      !/^[.]|[. ]$|[\\:<>|"*?]/.test(part) && !hasAsciiControl(part, true) && !reserved.test(part) &&
      !['__proto__', 'constructor', 'prototype'].includes(part));
}
