import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import os from "node:os";
import { toolEnv } from "./toolchain.mjs";

/** @type {Map<string, { child: import('node:child_process').ChildProcess, buf: string, at: number }>} */
const sessions = new Map();
const MAX_SESSIONS = 4;
const IDLE_MS = 10 * 60 * 1000;
const DEAD_MS = 10_000;

function sweep() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    const dead = s.child.exitCode != null && now - s.at > DEAD_MS;
    const idle = now - s.at > IDLE_MS;
    if (!dead && !idle) continue;
    try {
      s.child.kill();
    } catch {
      /* */
    }
    sessions.delete(id);
  }
}

function shellBin() {
  if (process.platform === "win32") {
    return { file: process.env.ComSpec || "cmd.exe", args: ["/K"] };
  }
  return { file: process.env.SHELL || "/bin/bash", args: ["-i"] };
}

export function termStart(cwd) {
  sweep();
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) {
      try {
        oldest[1].child.kill();
      } catch {
        /* */
      }
      sessions.delete(oldest[0]);
    }
  }
  const id = randomBytes(8).toString("hex");
  const sh = shellBin();
  const child = spawn(sh.file, sh.args, {
    cwd: cwd || process.cwd(),
    shell: false,
    env: { ...toolEnv(), TERM: "xterm-256color" },
    windowsHide: true,
  });
  const rec = { child, buf: "", at: Date.now() };
  const cap = (s) => s.slice(-80_000);
  child.stdout?.on("data", (d) => {
    rec.buf = cap(rec.buf + d.toString());
  });
  child.stderr?.on("data", (d) => {
    rec.buf = cap(rec.buf + d.toString());
  });
  child.on("close", () => {
    rec.buf = cap(rec.buf + "\r\n[Beendet]\r\n");
    rec.at = Date.now();
    setTimeout(() => sessions.delete(id), DEAD_MS);
  });
  sessions.set(id, rec);
  return { id, shell: sh.file };
}

export function termWrite(id, data) {
  sweep();
  const s = sessions.get(id);
  if (!s?.child.stdin) return false;
  s.at = Date.now();
  try {
    s.child.stdin.write(String(data ?? ""));
    return true;
  } catch {
    return false;
  }
}

export function termRead(id) {
  sweep();
  const s = sessions.get(id);
  if (!s) return { ok: false, data: "", alive: false };
  s.at = Date.now();
  const data = s.buf;
  s.buf = "";
  return { ok: true, data, alive: s.child.exitCode == null };
}

export function termKill(id) {
  const s = sessions.get(id);
  if (!s) return false;
  try {
    s.child.kill();
  } catch {
    /* */
  }
  sessions.delete(id);
  return true;
}

export function termPlatform() {
  return { platform: process.platform, shell: shellBin().file, home: os.homedir() };
}
