import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import os from "node:os";

/** @type {Map<string, { child: import('node:child_process').ChildProcess, buf: string }>} */
const sessions = new Map();

function shellBin() {
  if (process.platform === "win32") {
    return { file: process.env.ComSpec || "cmd.exe", args: ["/K"] };
  }
  return { file: process.env.SHELL || "/bin/bash", args: ["-i"] };
}

export function termStart(cwd) {
  const id = randomBytes(8).toString("hex");
  const sh = shellBin();
  const child = spawn(sh.file, sh.args, {
    cwd: cwd || process.cwd(),
    shell: false,
    env: { ...process.env, TERM: "xterm-256color" },
    windowsHide: true,
  });
  const rec = { child, buf: "" };
  const cap = (s) => s.slice(-80_000);
  child.stdout?.on("data", (d) => {
    rec.buf = cap(rec.buf + d.toString());
  });
  child.stderr?.on("data", (d) => {
    rec.buf = cap(rec.buf + d.toString());
  });
  child.on("close", () => {
    rec.buf = cap(rec.buf + "\r\n[Beendet]\r\n");
    setTimeout(() => sessions.delete(id), 30_000);
  });
  sessions.set(id, rec);
  return { id, shell: sh.file };
}

export function termWrite(id, data) {
  const s = sessions.get(id);
  if (!s?.child.stdin) return false;
  try {
    s.child.stdin.write(String(data ?? ""));
    return true;
  } catch {
    return false;
  }
}

export function termRead(id) {
  const s = sessions.get(id);
  if (!s) return { ok: false, data: "", alive: false };
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
