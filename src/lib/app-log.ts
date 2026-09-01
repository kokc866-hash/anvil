import { redactPatterns } from "./vault-redact.ts";
import { ANVIL_BUILD, ANVIL_VERSION } from "./version.ts";

export type AppLogLine = { at: number; tag: string; msg: string };

const LS = "anvil-applog";
const LS_ON = "anvil-applog-on";
const MAX = 400;
const EVT = "anvil-applog";

let lines: AppLogLine[] = [];
let on = true;
let loaded = false;
let booted = false;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    if (typeof localStorage === "undefined") return;
    const flag = localStorage.getItem(LS_ON);
    if (flag === "0") on = false;
    const raw = localStorage.getItem(LS);
    if (!raw) return;
    const v = JSON.parse(raw) as AppLogLine[];
    if (Array.isArray(v)) lines = v.slice(-MAX);
  } catch {
    lines = [];
  }
}

function save() {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(LS, JSON.stringify(lines.slice(-MAX)));
    localStorage.setItem(LS_ON, on ? "1" : "0");
  } catch {
    /* quota */
  }
}

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

export function appLogOn(): boolean {
  load();
  return on;
}

export function setAppLogOn(v: boolean) {
  load();
  on = v;
  save();
  emit();
}

export function appLogLines(): AppLogLine[] {
  load();
  return lines;
}

export function appLog(tag: string, msg: string) {
  load();
  if (!on) return;
  const text = redactPatterns(String(msg ?? "").replace(/\s+/g, " ").trim()).text.slice(0, 220);
  if (!text) return;
  const row: AppLogLine = { at: Date.now(), tag: String(tag || "app").slice(0, 16), msg: text };
  lines = [...lines, row].slice(-MAX);
  save();
  emit();
}

function clock(at: number): string {
  try {
    return new Date(at).toISOString().slice(11, 19);
  } catch {
    return "??:??:??";
  }
}

export function dumpAppLog(): string {
  load();
  const native = typeof window !== "undefined" && Boolean((window as unknown as { anvilNative?: unknown }).anvilNative);
  const ua = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 80) : "-";
  const head = [
    `Anvil ${ANVIL_VERSION} (${ANVIL_BUILD})`,
    `electron=${native ? "yes" : "no"} ua=${ua}`,
    "— App-Log, kein Workspace —",
  ].join("\n");
  const body = lines.map((l) => `${clock(l.at)} ${l.tag.padEnd(7)} ${l.msg}`).join("\n");
  return `${head}\n${body}\n`;
}

export function bootAppLog() {
  if (booted) return;
  booted = true;
  load();
  appLog("boot", `Anvil ${ANVIL_VERSION}`);
}

export function clearAppLog() {
  load();
  lines = [];
  save();
  emit();
}

export async function copyAppLog(): Promise<boolean> {
  const text = dumpAppLog();
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
}

export function exportAppLog() {
  const blob = new Blob([dumpAppLog()], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `anvil-debug-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function subscribeAppLog(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVT, fn);
  return () => window.removeEventListener(EVT, fn);
}

export function logHost(url: string): string {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw.includes("://") ? raw : `http://${raw}`).host;
  } catch {
    return raw.replace(/https?:\/\//i, "").split("/")[0] || "";
  }
}
