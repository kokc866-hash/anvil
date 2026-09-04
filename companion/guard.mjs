/** Shared companion checks — CORS, token, paths, LLM proxy, allowlist. */
import { timingSafeEqual } from "node:crypto";
import os from "node:os";
import path from "node:path";

export const MAX_BODY = Number(process.env.ANVIL_COMPANION_MAX_BODY || 24_000_000);

export const RUN_ALLOW = new Set([
  "godot",
  "godot4",
  "unity",
  "Unity",
  "UnrealEditor",
  "cargo",
  "love",
  "go",
  "python",
  "python3",
  "py",
  "node",
  "npm",
  "npx",
  "rustc",
  "java",
  "javac",
  "php",
  "ruby",
  "dotnet",
  "gcc",
  "g++",
  "cc",
  "c++",
  "clang",
  "clang++",
  "tsc",
  "pytest",
]);

const LLM_HDR = /^(content-type|accept|authorization|x-api-key|openai-beta|openai-organization)$/i;

export function isLoopbackHost(host) {
  const h = String(host || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0:0:0:0:0:0:0:1";
}

export function isLanHost(host) {
  const h = String(host || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (h === "169.254.169.254" || h === "0.0.0.0" || h === "::" || h === "metadata.google.internal") return false;
  if (isLoopbackHost(h)) return true;
  if (h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".internal")) return true;
  const p = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!p) return false;
  const a = Number(p[1]);
  const b = Number(p[2]);
  if (a === 10 || a === 127 || (a === 192 && b === 168)) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function allowCorsOrigin(origin) {
  const raw = String(origin || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    if (!isLanHost(u.hostname) && !isLoopbackHost(u.hostname)) return "";
    return u.origin;
  } catch {
    return "";
  }
}

export function pairTarget(to) {
  const raw = String(to || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    if (!isLoopbackHost(u.hostname)) return "";
    return u.origin;
  } catch {
    return "";
  }
}

export function tokenOk(got, expect) {
  const a = Buffer.from(String(expect || ""), "utf8");
  const b = Buffer.from(String(got || ""), "utf8");
  if (!a.length) return false;
  const n = Math.max(a.length, b.length);
  const pa = Buffer.alloc(n);
  const pb = Buffer.alloc(n);
  a.copy(pa);
  b.copy(pb);
  return a.length === b.length && timingSafeEqual(pa, pb);
}

export function llmHeaders(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!LLM_HDR.test(k)) continue;
    if (v == null) continue;
    out[k] = String(v);
  }
  return out;
}

export function blockedCwd(resolved) {
  const n = String(resolved || "").replace(/\\/g, "/").toLowerCase();
  if (!n) return true;
  if (/(^|\/)\.ssh(\/|$)/.test(n) || /(^|\/)\.gnupg(\/|$)/.test(n)) return true;
  const home = path.resolve(os.homedir()).replace(/\\/g, "/").toLowerCase();
  if (n === home || n.startsWith(home + "/")) return false;
  if (/^\/(etc|usr|bin|sbin|boot|sys|proc|dev|root|var)(\/|$)/.test(n)) return true;
  if (/^[a-z]:\/windows(\/|$)/.test(n)) return true;
  if (/^[a-z]:\/program files( \(x86\))?(\/|$)/.test(n)) return true;
  return false;
}

export function homeOk(resolved) {
  const next = path.resolve(String(resolved || ""));
  if (blockedCwd(next)) return false;
  const home = path.resolve(os.homedir()).replace(/\\/g, "/").toLowerCase();
  const n = next.replace(/\\/g, "/").toLowerCase();
  if (n === home || n.startsWith(home + "/")) return true;
  const tmp = path.resolve(os.tmpdir()).replace(/\\/g, "/").toLowerCase();
  if (n === tmp || n.startsWith(tmp + "/")) return true;
  return false;
}

export function insideRoot(root, full) {
  const a = path.resolve(root);
  const b = path.resolve(full);
  return b === a || b.startsWith(a + path.sep);
}

export function runAllowed(bin) {
  const base = path.basename(String(bin || ""));
  return RUN_ALLOW.has(base) || RUN_ALLOW.has(String(bin || ""));
}

export function mcpProtocol(wanted) {
  const v = String(wanted || "");
  if (v === "2025-03-26" || v === "2024-11-05") return v;
  return "2025-03-26";
}

export function whichExts() {
  return process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
}
