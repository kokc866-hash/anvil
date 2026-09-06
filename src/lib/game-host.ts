import { ANVIL_ENGINE } from "./engine-source.ts";
import { DEFAULT_INPUT_MAP, type InputMap } from "./input-map.ts";

export function looksGraphical(code: string): boolean {
  return /canvas|getContext\s*\(|requestAnimationFrame|document\.(body|getElementById|createElement)|addEventListener\s*\(\s*['"]key|Anvil\.(run|create|attach)/i.test(
    code,
  );
}
const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
export function withEngine(html: string, map: InputMap = DEFAULT_INPUT_MAP): string {
  const clean = html
    .replace(/<script\b[^>]*data-anvil-(?:engine|map)[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[^>]*data-anvil-boot[^>]*>[\s\S]*?<\/style\s*>/gi, "");
  const tags = `<style data-anvil-boot>canvas{max-width:100%}</style><script data-anvil-map>window.__ANVIL_INPUT__=${json(map)}</script><script data-anvil-engine>${ANVIL_ENGINE.replace(/<\/script/gi, "<\\/script")}</script>`;
  if (/<head\b[^>]*>/i.test(clean)) return clean.replace(/<head\b[^>]*>/i, (m) => m + tags);
  if (/<html\b[^>]*>/i.test(clean))
    return clean.replace(/<html\b[^>]*>/i, (m) => m + `<head>${tags}</head>`);
  const doctype = clean.match(/^\s*<!doctype[^>]*>/i)?.[0] || "<!doctype html>";
  return `${doctype}<html><head>${tags}</head><body>${clean.replace(/^\s*<!doctype[^>]*>/i, "")}</body></html>`;
}
export function wrapJsGame(
  code: string,
  map: InputMap = DEFAULT_INPUT_MAP,
  opts?: { module?: boolean },
): string {
  const module = Boolean(opts?.module) || /^\s*(?:import|export)\b/m.test(code);
  return withEngine(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
html,body{margin:0;height:100%;background:#0a0a0b;color:#ececec;font:14px system-ui,sans-serif;overflow:hidden}
body{display:flex;align-items:center;justify-content:center}canvas{max-width:100%;max-height:100%;touch-action:none}
</style></head><body><script${module ? ' type="module"' : ""}>${code.replace(/<\/script/gi, "<\\/script")}\n</script></body></html>`,
    map,
  );
}
export const wrapJsCanvas = wrapJsGame;
