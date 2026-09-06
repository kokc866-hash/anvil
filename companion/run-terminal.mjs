import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const which = (name) => { const r = spawnSync("which", [name], { encoding: "utf8" }); return r.status === 0 ? r.stdout.trim() : ""; };

export function terminalStep(step, cwd, env, folders) {
  const manifest = path.join(folders.dir, "terminal.json");
  writeFileSync(manifest, JSON.stringify({ ...step, cwd }), { mode: 0o600 });
  const host = fileURLToPath(new URL("./terminal-runner.mjs", import.meta.url));
  if (process.platform === "win32") return { file: process.execPath, args: [host, manifest], env: { ...env, ELECTRON_RUN_AS_NODE: "1" } };
  const terminal = process.env.DISPLAY && (which("x-terminal-emulator") || which("xterm"));
  if (!terminal) throw new Error("Dieses Programm benötigt ein interaktives Terminal. Auf diesem Rechner ist kein Desktop-Terminal verfügbar.");
  return { file: terminal, args: ["-e", process.execPath, host, manifest], env: { ...env, ELECTRON_RUN_AS_NODE: "1" } };
}
