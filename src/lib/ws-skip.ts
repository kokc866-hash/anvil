export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".vercel",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  "vendor",
  "coverage",
  ".turbo",
  ".cache",
  "out",
  "bin",
  "obj",
  ".pnpm-store",
  "Pods",
  ".idea",
  ".gradle",
  ".output",
  ".nuxt",
  ".svelte-kit",
]);

const SKIP_LOCK = /(?:^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb)$/i;
const SKIP_BIN =
  /\.(min\.(js|css)|map|wasm|pack|woff2?|ttf|eot|png|jpe?g|gif|webp|ico|mp4|mp3|zip|gz|br|7z|exe|dll|so|dylib|o|a|pyc|class|jar|lockb)$/i;
const SOURCE =
  /\.(py|ts|tsx|mts|cts|js|jsx|mjs|cjs|go|rs|java|kt|c|cc|cpp|h|hpp|cs|php|rb|md|html|css|json|toml|yml|yaml|sql|sh|vue|svelte|txt)$/i;

export function skipDirName(name: string): boolean {
  return SKIP_DIRS.has(name);
}

export function skipPath(path: string): boolean {
  const norm = path.replace(/\\/g, "/");
  const parts = norm.split("/");
  for (const p of parts) {
    if (SKIP_DIRS.has(p)) return true;
  }
  const base = parts[parts.length - 1] ?? "";
  return SKIP_LOCK.test(base) || SKIP_BIN.test(base);
}

export function isSourcePath(path: string): boolean {
  return SOURCE.test(path);
}

export function contentSig(s: string): string {
  let h = s.length | 0;
  const step = s.length > 8000 ? Math.ceil(s.length / 8000) : 1;
  for (let i = 0; i < s.length; i += step) h = Math.imul(h, 33) ^ s.charCodeAt(i);
  if (s.length) h = Math.imul(h, 33) ^ s.charCodeAt(s.length - 1);
  return `${s.length}:${h >>> 0}`;
}

export function rankPaths(paths: string[], prefer: string[] = []): string[] {
  const pref = new Set(prefer);
  const rank = (p: string) => (pref.has(p) ? 0 : isSourcePath(p) ? 1 : 2);
  return [...paths].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 10_000) return `${Math.round(n)} B`;
  if (n < 1_000_000) return `${Math.round(n / 1024)} KB`;
  const mb = n / 1_000_000;
  return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
}
