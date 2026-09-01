import { ANVIL_ENGINE } from "./engine-source.ts";
import { DEFAULT_INPUT_MAP, type InputMap } from "./input-map.ts";

export function looksGraphical(code: string): boolean {
  return /canvas|getContext\s*\(|requestAnimationFrame|document\.(body|getElementById|createElement)|addEventListener\s*\(\s*['"]key|Anvil\.(run|create)/i.test(
    code,
  );
}

function inject(html: string, tag: string): string {
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${tag}</head>`);
  if (/<body[^>]*>/i.test(html)) return html.replace(/<body[^>]*>/i, (m) => `${m}${tag}`);
  return `${tag}${html}`;
}

const BOOT_CSS = `<style data-anvil-boot>
html,body{margin:0;min-height:100%;background:#0a0a0b;color:#ececec}
canvas{display:block;max-width:100%;touch-action:none}
button,a,[role=button]{cursor:pointer}
</style>`;

export function withEngine(html: string, map: InputMap = DEFAULT_INPUT_MAP): string {
  const cfg = `<script data-anvil-map>window.__ANVIL_INPUT__=${JSON.stringify(map)}</script>`;
  let out = html;
  if (!/data-anvil-boot/.test(out)) out = inject(out, BOOT_CSS);
  out = out.includes("data-anvil-map")
    ? out.replace(/<script data-anvil-map>[\s\S]*?<\/script>/, cfg)
    : inject(out, cfg);
  if (!out.includes("data-anvil-engine")) {
    out = inject(out, `<script data-anvil-engine>${ANVIL_ENGINE}</script>`);
  }
  return out;
}

export function wrapJsGame(code: string, map: InputMap = DEFAULT_INPUT_MAP, opts?: { module?: boolean }): string {
  const mod = Boolean(opts?.module) || /^\s*(?:import|export)\b/m.test(code);
  const body = mod
    ? `<script type="module">
${code}
</script>`
    : `<script>
try {
${code}
} catch (err) {
  document.body.textContent = (err && err.stack) ? err.stack : String(err);
}
</script>`;
  return withEngine(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<style>
  html, body { margin: 0; height: 100%; background: #0a0a0b; color: #ececec; font-family: ui-sans-serif, system-ui, sans-serif; overflow: hidden; }
  body { display: flex; align-items: center; justify-content: center; }
  canvas { image-rendering: pixelated; image-rendering: crisp-edges; max-width: 100%; max-height: 100%; touch-action: none; }
</style>
</head>
<body>
${body}
</body>
</html>`);
}

export const wrapJsCanvas = wrapJsGame;
