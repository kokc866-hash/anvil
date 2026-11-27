const OPEN_MAX = 1_000_000, CLOSED_MAX = 200_000;

export function isTsSource(path: string, source: string, opened = false): boolean {
  return /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(path)
    && !path.includes("node_modules") && !path.includes("anvil-lib")
    && source.length > 0 && source.length < (opened ? OPEN_MAX : CLOSED_MAX);
}

export function hasTsSource(files: Record<string, string>, open: string[] = []): boolean {
  const opened = new Set(open);
  return Object.entries(files).some(([path, source]) => isTsSource(path, source, opened.has(path)));
}

export function tsRoots(files: Record<string, string>, open: string[] = []): string[] {
  const opened = new Set(open);
  const all = Object.keys(files).filter((path) => isTsSource(path, files[path], opened.has(path)));
  const paths = new Set(all);
  return [...open.filter((path) => paths.has(path)), ...all.filter((path) => !opened.has(path))].slice(0, 64);
}
