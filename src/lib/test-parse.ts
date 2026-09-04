export type TestHit = {
  path: string;
  line: number;
  name: string;
  ok: boolean;
  text: string;
  skip?: boolean;
};

const DISCOVER_CAP = 200;
const PARSE_CAP = 200;
const SKIP_TREE = /(^|\/)(node_modules|\.git|dist|build|__pycache__|coverage|target|vendor)(\/|$)/;
const SKIP_TEST_BASE = /^(conftest|__init__)\.(py|php)$/i;
const TEST_EXT =
  /\.(py|js|ts|tsx|jsx|mjs|cjs|go|rs|cs|php|rb|java)$/i;

export function isTestExt(path: string): boolean {
  return TEST_EXT.test(path.replace(/\\/g, "/"));
}

export function isTestFile(path: string): boolean {
  const n = path.replace(/\\/g, "/");
  if (SKIP_TREE.test(n) || n.startsWith("node_modules/")) return false;
  const base = n.split("/").pop() ?? "";
  if (SKIP_TEST_BASE.test(base)) return false;
  if (!TEST_EXT.test(base) && !TEST_EXT.test(n)) return false;
  return (
    /(^|\/)tests?\//.test(n) ||
    /\.(test|spec)\./.test(n) ||
    /(^|\/)test_[^/]+\.(py|rb|php)$/.test(n) ||
    /_test\.(go|rs|php|rb)$/.test(n) ||
    /Tests?\.(java|cs)$/.test(n)
  );
}

export function fileHasInlineTests(path: string, src: string): boolean {
  if (SKIP_TREE.test(path.replace(/\\/g, "/"))) return false;
  if (/\.rs$/i.test(path) && /#\[test\]/.test(src)) return true;
  if (/\.cs$/i.test(path) && /\[(?:Fact|Theory|Test(?:Method)?)\]/.test(src)) return true;
  return false;
}

function nextFnName(lines: string[], from: number): { name: string; line: number } | null {
  for (let j = from + 1; j < Math.min(lines.length, from + 6); j++) {
    const t = lines[j];
    const m =
      t.match(/^\s*(?:pub(?:\s+\([^)]+\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)\s*\(/) ||
      t.match(/^\s*(?:public|protected|internal|private)?\s*(?:static\s+)?(?:async\s+)?(?:void|Task|public)\s+([A-Za-z_][\w]*)\s*\(/) ||
      t.match(/^\s*(?:public\s+)?(?:void|async\s+)?(?:Task\s+)?([A-Za-z_][\w]*)\s*\(\s*\)/) ||
      t.match(/^\s*(?:public|protected)?\s*(?:static\s+)?void\s+([A-Za-z_][\w]*)\s*\(/);
    if (m) return { name: m[1], line: j + 1 };
  }
  return null;
}

export function discoverTests(files: Record<string, string>): TestHit[] {
  const out: TestHit[] = [];
  for (const path of Object.keys(files).sort()) {
    const src = files[path];
    if (!isTestFile(path) && !fileHasInlineTests(path, src ?? "")) continue;
    if (!src || src.length > 200_000) continue;
    const lines = src.split("\n");
    let found = 0;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i];
      const m =
        t.match(/^\s*(?:async\s+)?def\s+(test_[A-Za-z_]\w*)\s*\(/) ||
        t.match(/^\s*(?:it|test|describe)\s*\(\s*['"`]([^'"`]+)['"`]/) ||
        t.match(/^\s*func\s+(Test[A-Za-z_]\w*)\s*\(/) ||
        t.match(/^\s*(?:pub(?:\s+\([^)]+\))?\s+)?(?:async\s+)?fn\s+(test_[A-Za-z_]\w*)\s*\(/) ||
        t.match(/^\s*(?:public\s+|protected\s+)?(?:static\s+)?void\s+(test[A-Za-z_]\w*)\s*\(/) ||
        t.match(/^\s*(?:def|function)\s+(test_[A-Za-z_]\w*)\s*[\(=]/);
      if (m) {
        out.push({ path, line: i + 1, name: (m[1] || t.trim()).slice(0, 80), ok: true, text: "", skip: true });
        found += 1;
        if (out.length >= DISCOVER_CAP) return out;
        continue;
      }
      if (/^\s*#\[test\]/.test(t) || /^\s*\[(?:Fact|Theory|Test(?:Method)?)\]/.test(t) || /^\s*@Test\b/.test(t)) {
        const nxt = nextFnName(lines, i);
        const name = nxt?.name ?? t.trim().slice(0, 80);
        const line = nxt?.line ?? i + 1;
        if (!out.some((h) => h.path === path && h.name === name)) {
          out.push({ path, line, name, ok: true, text: "", skip: true });
          found += 1;
          if (out.length >= DISCOVER_CAP) return out;
        }
      }
    }
    if (!found) {
      out.push({ path, line: 1, name: path.split("/").pop() ?? path, ok: true, text: "", skip: true });
      if (out.length >= DISCOVER_CAP) return out;
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
    hits.push({ path, line: line || 1, name: name.slice(0, 80), ok, text: text.slice(0, 220), skip });
  };

  for (const raw of blob.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    let m = line.match(/^--- (PASS|FAIL|SKIP):\s+(\S+)/);
    if (m) {
      const name = m[2];
      const path = guessPath(name, files) || guessGoFile(name, files);
      push(path, lineOf(files[path], name), name, m[1] === "PASS" || m[1] === "SKIP", line, m[1] === "SKIP");
      continue;
    }

    m = line.match(/^test\s+(\S+)(?:\s+-\s+should panic)?\s+\.\.\.\s+(ok|FAILED|ignored)\b/i);
    if (m) {
      const name = m[1];
      const path = guessRustFile(name, files);
      const tok = m[2].toLowerCase();
      push(path, lineOf(files[path], name.split("::").pop() ?? name), name, tok === "ok" || tok === "ignored", line, tok === "ignored");
      continue;
    }

    m = line.match(/^(not ok|ok)\s+(?:\d+\s+)?-?\s*(.+)$/i);
    if (m && !/^\d+(\.\d+)?s$/.test(m[2].trim()) && !/\s+\d+\.\d+s$/.test(m[2]) && !/\t/.test(m[2])) {
      const rest = m[2].trim();
      const loc = rest.match(/(\S+\.(?:py|js|ts|tsx|jsx|mjs|cjs|go|rs|cs|php|rb|java))(?::(\d+))?/);
      const path = loc ? guessPath(loc[1], files) : guessPath(rest.split(/\s+/)[0], files);
      const name = rest.replace(loc?.[0] ?? "", "").replace(/^[·:>-]\s*/, "").trim() || rest;
      const okTok = m[1].toLowerCase() === "ok";
      push(path, loc?.[2] ? Number(loc[2]) : lineOf(files[path], name), name, okTok, line, false);
      continue;
    }

    m = line.match(/^\s*(Passed|Failed|Skipped)\s+(\S+)/);
    if (m) {
      const name = m[2];
      const path = guessPath(name, files);
      push(path, lineOf(files[path], name), name, /Passed|Skipped/i.test(m[1]), line, /Skipped/i.test(m[1]));
      continue;
    }

    m = line.match(/^(\S+\.py)(::\S+)?\s+(PASSED|FAILED|ERROR|SKIPPED)/i);
    if (m) {
      const path = guessPath(m[1], files);
      const name = (m[2] ?? m[1]).replace(/^::/, "");
      push(path, lineOf(files[path], name), name, /PASSED|SKIPPED/i.test(m[3]), line, /SKIPPED/i.test(m[3]));
      continue;
    }

    m = line.match(/^(PASS|FAIL|SKIP|✓|×|✔|✖)\s+[·>-]?\s*(.+)$/i);
    if (m) {
      const tok = m[1].toLowerCase();
      const rest = m[2].trim();
      const loc = rest.match(/(\S+\.(?:py|js|ts|tsx|jsx|mjs|cjs|go|rs|cs|php|rb|java))(?::(\d+))?/);
      const path = loc ? guessPath(loc[1], files) : guessPath(rest.split(/\s+/)[0], files);
      const name = rest.replace(loc?.[0] ?? "", "").replace(/^[·:>-]\s*/, "").trim() || rest;
      push(path, loc?.[2] ? Number(loc[2]) : lineOf(files[path], name), name.slice(0, 80), /pass|✓|✔/.test(tok), line, /skip/i.test(tok));
      continue;
    }

    m = line.match(/^(?:ok|FAIL)\s+(\S+)/);
    if (m && !/^ok\s+\d+/.test(line)) {
      const pkg = m[1];
      const path = guessPath(pkg, files);
      if (files[path] || /_test\.go$/.test(path) || path.includes("/")) {
        push(path, 1, pkg, /^ok\b/.test(line), line);
      }
    }

    m = line.match(/^(?:FAIL(?:ED)?|ERROR)\s+(\S+)/i);
    if (m) push(guessPath(m[1], files), 1, m[1], false, line);

    m = line.match(/(\S+\.(?:py|js|ts|tsx|jsx|go|rs|cs|php|rb|java)):(\d+)/);
    if (m && /Error|FAIL|assert|Exception/i.test(line)) {
      push(guessPath(m[1], files), Number(m[2]), m[1], false, line);
    }
  }

  if (!hits.length && /fail|error|assert/i.test(blob)) {
    const scoped = scopedFiles(files, blob);
    for (const d of discoverTests(scoped)) push(d.path, d.line, d.name, false, blob.slice(0, 120));
  }
  return hits.slice(0, PARSE_CAP);
}

function scopedFiles(files: Record<string, string>, blob: string): Record<string, string> {
  const keys = Object.keys(files);
  if (keys.length <= 1) return files;
  const hit = keys.filter((p) => blob.includes(p) || blob.includes(p.split("/").pop() ?? p));
  if (!hit.length) return files;
  const out: Record<string, string> = {};
  for (const p of hit) out[p] = files[p];
  return out;
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
  const pass = hits.filter((h) => h.ok && !h.skip);
  const idle = hits.filter((h) => h.skip);
  if (!fails.length && !pass.length) {
    if (idle.length) {
      return "Tests noch nicht gelaufen. Testdateien ausführen (shell: pytest / npm test / go test), Output lesen.";
    }
    return "Keine Testergebnisse.";
  }
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

function guessGoFile(name: string, files: Record<string, string>): string {
  const short = name.replace(/^.*\//, "").replace(/\.\w+$/, "");
  const hit = Object.keys(files).find((p) => /_test\.go$/i.test(p) && files[p]?.includes(short));
  return hit ?? Object.keys(files).find((p) => /_test\.go$/i.test(p)) ?? name;
}

function guessRustFile(name: string, files: Record<string, string>): string {
  const last = name.split("::").pop() ?? name;
  const hit = Object.keys(files).find((p) => /\.rs$/i.test(p) && files[p]?.includes(last));
  return hit ?? Object.keys(files).find((p) => isTestFile(p) && p.endsWith(".rs")) ?? name;
}

function lineOf(src: string | undefined, name: string): number {
  if (!src || !name) return 1;
  const n = name.replace(/^.*::/, "");
  const lines = src.split("\n");
  const i = lines.findIndex((l) => l.includes(n) && /def |it\(|test\(|func |fn |void /.test(l));
  return i >= 0 ? i + 1 : 1;
}

export function pruneTestMap(
  map: Record<string, TestHit>,
  files: Record<string, string>,
  ranPaths?: string[],
): Record<string, TestHit> {
  const ran = ranPaths?.length ? new Set(ranPaths) : null;
  const next: Record<string, TestHit> = {};
  for (const [k, h] of Object.entries(map)) {
    if (!(h.path in files)) continue;
    if (ran?.has(h.path)) continue;
    next[k] = h;
  }
  return next;
}

export function dropTestPaths(map: Record<string, TestHit>, gone: (p: string) => boolean): Record<string, TestHit> {
  const next: Record<string, TestHit> = {};
  for (const [k, h] of Object.entries(map)) {
    if (!gone(h.path)) next[k] = h;
  }
  return next;
}

export function remapTestMap(map: Record<string, TestHit>, from: string, to: string): Record<string, TestHit> {
  const next: Record<string, TestHit> = {};
  for (const [, h] of Object.entries(map)) {
    let path = h.path;
    if (path === from) path = to;
    else if (path.startsWith(`${from}/`)) path = to + path.slice(from.length);
    next[`${path}:${h.name}`] = path === h.path ? h : { ...h, path };
  }
  return next;
}

const TEST_HEAD =
  /^(?:npx\s+)?(?:npm(?:\s+run)?\s+test|vitest|jest|pytest|python3?\s+-m\s+pytest|go\s+test|cargo\s+test|dotnet\s+test|phpunit|rspec)\b/i;

export type ParsedTestCmd = { paths: string[]; filter?: string };

export function parseTestCommand(command: string): ParsedTestCmd | null {
  const cmd = command.trim();
  if (!TEST_HEAD.test(cmd)) return null;
  const rest = cmd.replace(TEST_HEAD, "").trim();
  const paths: string[] = [];
  let filter: string | undefined;
  const tokens = rest.match(/(?:[^\s"']+|"[^"]*"|'[^']*')/g) ?? [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].replace(/^['"]|['"]$/g, "");
    if (t === "-k" || t === "-run" || t === "--filter" || t === "--testNamePattern" || t === "-t") {
      const n = tokens[i + 1]?.replace(/^['"]|['"]$/g, "");
      if (n && !n.startsWith("-")) {
        filter = n;
        i += 1;
      }
      continue;
    }
    if (t.startsWith("-")) continue;
    if (t === "./..." || t === "...") continue;
    if (
      /\.(py|js|ts|tsx|jsx|mjs|cjs|go|rs|cs|php|rb|java)$/i.test(t) ||
      /(^|\/)tests?\//.test(t) ||
      t.startsWith("tests")
    ) {
      paths.push(t.replace(/^\.\//, ""));
    }
  }
  return { paths, filter };
}

export function isTestStepText(name: string, detail: string, status?: string): boolean {
  if (status === "err" || status === "run") return false;
  const blob = `${name} ${detail}`;
  if (!/\b(pytest|npm test|npx vitest|vitest|jest|go test|cargo test|dotnet test|phpunit)\b/i.test(blob)) return false;
  return /^(shell|tests)\b/i.test(name.trim()) || /\b(pytest|npm test|go test|cargo test|dotnet test)\b/i.test(name);
}

