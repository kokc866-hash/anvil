/** Temporary work may be shared by multiple Anvil profiles and processes. */
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const kinds = new Set(["run", "fmt", "lint", "dbg", "tc"]);
const ownedName = /^anvil-owned-(run|fmt|lint|dbg|tc)-p([1-9]\d*)-[a-zA-Z0-9]{6}$/;

export function makeAnvilTemp(kind, root = os.tmpdir()) {
  if (!kinds.has(kind)) throw new Error("Unknown Anvil temporary directory kind");
  // The previous sweeper only recognizes older prefixes.
  return mkdtempSync(path.join(path.resolve(root), `anvil-owned-${kind}-p${process.pid}-`));
}

function ownerExited(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === "ESRCH";
  }
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
  const root = path.resolve(opts.root || os.tmpdir());
  const maxAgeMs = opts.maxAgeMs ?? 15 * 60 * 1000;
  const toolchain = Boolean(opts.toolchain);
  const toolchainAge = opts.toolchainAgeMs ?? 24 * 60 * 60 * 1000;
  let ents = [];
  try {
    ents = readdirSync(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  const now = Date.now();
  let removed = 0;
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    // An old-format directory or an NSIS extraction may still be in use.
    const match = ownedName.exec(e.name);
    if (!match) continue;
    const [, kind, pid] = match;
    if ((kind === "tc" && !toolchain) || !ownerExited(Number(pid))) continue;
    const full = path.join(root, e.name);
    try {
      const limit = kind === "tc" ? toolchainAge : maxAgeMs;
      if (now - statSync(full).mtimeMs >= limit && rmDir(full)) removed += 1;
    } catch {
      /* Another process may have already cleaned up this directory. */
    }
  }
  return removed;
}
