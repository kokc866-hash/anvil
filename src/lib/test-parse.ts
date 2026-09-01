export type TestHit = {
  path: string;
  line: number;
  name: string;
  ok: boolean;
  text: string;
  skip?: boolean;
};

export function isTestFile(path: string): boolean {
  return (
    /(^|\/)tests?\//.test(path) ||
    /\.(test|spec)\./.test(path) ||
    /(^|\/)test_[^/]+\.(py|rb|php)$/.test(path) ||
    /_test\.(go|rs|php|rb)$/.test(path) ||
    /Test\.java$/.test(path)
  );
}

export function discoverTests(files: Record<string, string>): TestHit[] {
  const out: TestHit[] = [];
  for (const path of Object.keys(files).sort()) {
    if (!isTestFile(path) || path.startsWith("node_modules/")) continue;
    const src = files[path];
    if (!src || src.length > 200_000) continue;
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i];
      const m =
        t.match(/^\s*(?:async\s+)?def\s+(test_[A-Za-z_]\w*)\s*\(/) ||
        t.match(/^\s*(?:it|test|describe)\s*\(\s*['"`]([^'"`]+)['"`]/) ||
        t.match(/^\s*func\s+(Test[A-Za-z_]\w*)\s*\(/) ||
        t.match(/^\s*(?:#\[test\]|fn\s+(test_[A-Za-z_]\w*))/);
      if (!m) continue;
      const name = (m[1] || t.trim()).slice(0, 80);
      out.push({ path, line: i + 1, name, ok: true, text: "", skip: true });
      if (out.length >= 120) return out;
    }
    if (!out.some((h) => h.path === path)) {
      out.push({ path, line: 1, name: path.split("/").pop() ?? path, ok: true, text: "", skip: true });
    }
  }
  return out;
}

export function parseTests(stdout: string, stderr: string, files: Record<string, string>): TestHit[] {
  const blob = `${stdout}\n${stderr}`;
  const hits: TestHit[] = [];
  const seen = new Set<string>();

  const push = (path: string, line: number, name: string, ok: boolean, text: string, skip = false) => {
    const key = `${path}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ path, line: line || 1, name, ok, text: text.slice(0, 220), skip });
  };

  for (const raw of blob.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let m = line.match(/^(PASS|FAIL|SKIP|✓|×|✔|✖|ok|not ok)\s+[·>-]?\s*(.+)$/i);
    if (m) {
      const tok = m[1].toLowerCase();
      const rest = m[2].trim();
      const loc = rest.match(/(\S+\.(?:py|js|ts|tsx|jsx|go|rs|cs|php|rb|java))(?::(\d+))?/);
      const path = loc ? guessPath(loc[1], files) : guessPath(rest.split(/\s+/)[0], files);
      const name = rest.replace(loc?.[0] ?? "", "").replace(/^[·:>-]\s*/, "").trim() || rest;
      push(path, loc?.[2] ? Number(loc[2]) : lineOf(files[path], name), name.slice(0, 80), /pass|✓|✔|^ok$/i.test(tok), line, /skip/i.test(tok));
      continue;
    }
    m = line.match(/^(\S+\.py)(::\S+)?\s+(PASSED|FAILED|ERROR|SKIPPED)/i);
    if (m) {
      const path = guessPath(m[1], files);
      const name = (m[2] ?? m[1]).replace(/^::/, "");
      push(path, lineOf(files[path], name), name, /PASSED|SKIPPED/i.test(m[3]), line, /SKIPPED/i.test(m[3]));
      continue;
    }
    m = line.match(/^(?:FAIL(?:ED)?|ERROR)\s+(\S+)/i);
    if (m) push(guessPath(m[1], files), 1, m[1], false, line);
    m = line.match(/(\S+\.(?:py|js|ts|tsx|go|rs|cs|php|rb|java)):(\d+)/);
    if (m && /Error|FAIL|assert|Exception/i.test(line)) {
      push(guessPath(m[1], files), Number(m[2]), m[1], false, line);
    }
  }

  if (!hits.length && /fail|error|assert/i.test(blob)) {
    for (const d of discoverTests(files)) push(d.path, d.line, d.name, false, blob.slice(0, 120));
  }
  return hits.slice(0, 80);
}

export function mergeTests(discovered: TestHit[], results: TestHit[]): TestHit[] {
  const map = new Map<string, TestHit>();
  for (const d of discovered) map.set(`${d.path}:${d.name}`, { ...d });
  for (const r of results) {
    const key = `${r.path}:${r.name}`;
    const prev = map.get(key);
    if (prev) map.set(key, { ...prev, ok: r.ok, text: r.text, skip: Boolean(r.skip), line: r.line || prev.line });
    else {
      const sameFile = [...map.values()].find((p) => p.path === r.path && p.skip);
      if (sameFile && results.filter((x) => x.path === r.path).length === 1) {
        map.set(`${sameFile.path}:${sameFile.name}`, { ...sameFile, ok: r.ok, text: r.text, skip: Boolean(r.skip) });
      } else map.set(key, { ...r, skip: Boolean(r.skip) });
    }
  }
  return [...map.values()];
}

export function testsPrompt(hits: TestHit[]): string {
  const fails = hits.filter((h) => !h.ok && !h.skip);
  if (!fails.length) return "Alle Tests sind grün. Kurz bestätigen, nichts kaputt machen.";
  const lines = fails.slice(0, 24).map((h) => `${h.path}:${h.line} ${h.name} — ${h.text || "FAIL"}`);
  return `Diese Tests sind rot. Nur sie reparieren, dann die Testdateien ausführen.\n\n${lines.join("\n")}`;
}

export function guessPath(raw: string, files: Record<string, string>): string {
  const clean = raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/[:()].*$/, "");
  if (files[clean]) return clean;
  const base = clean.split("/").pop() ?? clean;
  return Object.keys(files).find((p) => p.endsWith(`/${base}`) || p === base) ?? clean;
}

function lineOf(src: string | undefined, name: string): number {
  if (!src || !name) return 1;
  const n = name.replace(/^.*::/, "");
  const lines = src.split("\n");
  const i = lines.findIndex((l) => l.includes(n) && /def |it\(|test\(|func |fn /.test(l));
  return i >= 0 ? i + 1 : 1;
}
