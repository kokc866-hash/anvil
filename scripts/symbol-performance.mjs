// Run: node --experimental-strip-types scripts/symbol-performance.mjs
// Timing is diagnostic only. Behavioral assertions do not depend on machine speed.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { listSymbols } from "../src/lib/lsp.ts";
import { DEF_RE } from "../src/lib/lsp-lint.ts";
import { parseFile } from "../src/lib/ws-index.ts";
import { searchableFiles } from "../src/lib/search.ts";

// The previous algorithms are retained only here to make before/after runs repeatable.
function beforeSymbols(src, path) {
  const hits = [], seen = new Set();
  for (const re of DEF_RE) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(src))) {
      const name = match[1], line = src.slice(0, match.index + 1).split("\n").length;
      const key = `${name}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ path, line, text: src.split("\n")[line - 1]?.trim() ?? name });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

const INDEX_PATTERNS = [
  [/(?:^|\n)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)\s*\(/g, "fn"],
  [/(?:^|\n)(?:export\s+)?class\s+([A-Za-z_]\w*)/g, "class"],
  [/(?:^|\n)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_]\w*)\s*=/g, "var"],
  [/(?:^|\n)(?:export\s+)?(?:type|interface|enum)\s+([A-Za-z_]\w*)/g, "type"],
  [/(?:^|\n)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/g, "fn"],
  [/(?:^|\n)class\s+([A-Za-z_]\w*)\s*[:(]/g, "class"],
  [/(?:^|\n)func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/g, "fn"],
  [/(?:^|\n)fn\s+([A-Za-z_]\w*)\s*[<(]/g, "fn"],
  [/(?:^|\n)(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/g, "type"],
];

function beforeIndex(path, source) {
  const src = source.slice(0, 120_000), lines = src.split("\n"), symbols = [], seen = new Set();
  for (const [re, kind] of INDEX_PATTERNS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(src))) {
      const name = match[1], line = src.slice(0, match.index + 1).split("\n").length, key = `${name}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      symbols.push({ name, kind, line, text: (lines[line - 1] ?? name).trim() });
    }
  }
  return { path, lang: "js", lines: source.split("\n").length, hint: "", symbols: symbols.sort((a, b) => a.line - b.line), imports: [] };
}

function sample(run) {
  const start = performance.now(), value = run();
  return { ms: performance.now() - start, value };
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const round = (n) => Number(n.toFixed(4));
  return { medianMs: round(sorted[Math.floor(sorted.length / 2)]), minMs: round(sorted[0]), maxMs: round(sorted.at(-1)) };
}

const repetitions = 5;
const results = [];
for (const count of [1000, 2500, 5000, 10000]) {
  const src = Array.from({ length: count }, (_, i) => `const symbol_${i} = ${i};`).join("\n"), path = "src/bench.ts";
  const before = [], after = [], cached = [], indexBefore = [], indexAfter = [];
  for (let pass = 0; pass < repetitions; pass++) {
    const legacy = sample(() => beforeSymbols(src, path));
    // A changed revision makes the measured call cold while retaining the same path.
    listSymbols(src + `\n// changed revision ${pass}`, path);
    const current = sample(() => listSymbols(src, path));
    const repeated = sample(() => listSymbols(src, path));
    assert.deepEqual(current.value, legacy.value);
    assert.equal(current.value.length, count);
    assert.equal(repeated.value, current.value);
    const oldRow = sample(() => beforeIndex(path, src)), newRow = sample(() => parseFile(path, src));
    assert.deepEqual(newRow.value, oldRow.value);
    before.push(legacy.ms); after.push(current.ms); cached.push(repeated.ms);
    indexBefore.push(oldRow.ms); indexAfter.push(newRow.ms);
  }
  results.push({ lines: count, chars: src.length, symbols: count, before: stats(before), after: stats(after),
    cached: stats(cached), indexBefore: stats(indexBefore), indexAfter: stats(indexAfter) });
}

const files = {};
for (let i = 0; i < 20; i++) files[`src/file${i}.ts`] = `export const key${i} = 'needle';\n` + "// pad\n".repeat(3000);
for (let i = 0; i < 100; i++) files[`node_modules/vendor/file${i}.js`] = "x".repeat(60_000);
for (let i = 0; i < 10; i++) files[`secrets/key${i}.pem`] = "x".repeat(100_000);
for (let i = 0; i < 50; i++) files[`assets/image${i}.png`] = "x".repeat(100_000);
files["oversized.ts"] = "x".repeat(2_000_000);
files["opaque.txt"] = "data:application/octet-stream;base64," + "x".repeat(100_000);
const filtered = searchableFiles(files);
assert.equal(Object.keys(filtered).length, 20);
assert.equal(filtered["src/file0.ts"], files["src/file0.ts"]);
const transferBefore = [], transferAfter = [], select = [];
for (let pass = 0; pass < repetitions; pass++) {
  transferBefore.push(sample(() => structuredClone(files)).ms);
  select.push(sample(() => searchableFiles(files)).ms);
  transferAfter.push(sample(() => structuredClone(filtered)).ms);
}
const searchTransfer = { filesBefore: Object.keys(files).length, filesAfter: Object.keys(filtered).length,
  charsBefore: Object.values(files).reduce((n, source) => n + source.length, 0),
  charsAfter: Object.values(filtered).reduce((n, source) => n + source.length, 0),
  cloneBefore: stats(transferBefore), selection: stats(select), cloneAfter: stats(transferAfter) };
process.stdout.write(JSON.stringify({ runtime: process.version, repetitions,
  note: "Artificial declarations and payload. Node timings are not desktop latency guarantees. All before/after results are behavior-checked on identical input.",
  results, searchTransfer }, null, 2) + "\n");
