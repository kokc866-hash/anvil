/** Anvil-Temp unter os.tmpdir(): anvil-run-*, anvil-fmt-*, … nicht ewig liegen lassen. */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const RUN = ["anvil-run-", "anvil-fmt-", "anvil-lint-", "anvil-dbg-"];

export function isAnvilTempName(name, { toolchain = false } = {}) {
  const n = String(name || "");
  if (RUN.some((p) => n.startsWith(p))) return true;
  return toolchain && n.startsWith("anvil-tc-");
}

export function rmDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
    return !existsSync(dir);
  } catch {
    return false;
  }
}

export function rmSoon(dir, tries = 8, waitMs = 8000) {
  if (rmDir(dir)) return;
  let n = tries;
  const tick = () => {
    n -= 1;
    if (rmDir(dir) || n <= 0) return;
    setTimeout(tick, waitMs);
  };
  setTimeout(tick, waitMs);
}

export function sweepAnvilTemp(opts = {}) {
  const root = opts.root || os.tmpdir();
  const maxAgeMs = opts.maxAgeMs ?? 15 * 60 * 1000;
  const keep = Math.max(0, Number(opts.keep) || 0);
  const toolchain = Boolean(opts.toolchain);
  const toolchainAge = opts.toolchainAgeMs ?? 24 * 60 * 60 * 1000;
  let ents = [];
  try {
    ents = readdirSync(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  const now = Date.now();
  const hits = [];
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    const tc = e.name.startsWith("anvil-tc-");
    if (tc && !toolchain) continue;
    if (!isAnvilTempName(e.name, { toolchain: tc })) continue;
    const full = path.join(root, e.name);
    let mtime = now;
    try {
      mtime = statSync(full).mtimeMs;
    } catch {
      continue;
    }
    hits.push({ full, age: now - mtime, tc });
  }
  hits.sort((a, b) => a.age - b.age);
  let removed = 0;
  let kept = 0;
  for (const h of hits) {
    const limit = h.tc ? toolchainAge : maxAgeMs;
    const stale = h.age >= limit;
    const overflow = !h.tc && kept >= keep;
    if (!stale && !overflow) {
      if (!h.tc) kept += 1;
      continue;
    }
    if (rmDir(h.full)) removed += 1;
    else rmSoon(h.full);
  }
  return removed;
}
