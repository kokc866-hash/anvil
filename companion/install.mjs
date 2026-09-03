import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Allowlisted winget ids only — never a free-form package name. */
export const INSTALL = {
  go: { id: "GoLang.Go", label: "Go" },
  rustc: { id: "Rustlang.Rustup", label: "Rust" },
  cargo: { id: "Rustlang.Rustup", label: "Rust" },
  javac: { id: "Microsoft.OpenJDK.21", label: "OpenJDK 21" },
  java: { id: "Microsoft.OpenJDK.21", label: "OpenJDK 21" },
  cc: { id: "LLVM.LLVM", label: "LLVM" },
  cxx: { id: "LLVM.LLVM", label: "LLVM" },
  php: { id: "PHP.PHP.8.3", label: "PHP" },
  ruby: { id: "RubyInstallerTeam.RubyWithDevKit.3.3", label: "Ruby" },
  python: { id: "Python.Python.3.12", label: "Python" },
  tsc: { id: "OpenJS.NodeJS.LTS", label: "Node.js" },
  dotnet: { id: "Microsoft.DotNet.SDK.8", label: ".NET SDK" },
  git: { id: "Git.Git", label: "Git" },
};

function which(bin) {
  const env = process.env.PATH || "";
  const ext = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of env.split(path.delimiter)) {
    for (const e of ext) {
      const p = path.join(dir, bin + e);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

export function installerKind() {
  if (which("winget")) return "winget";
  if (which("scoop")) return "scoop";
  if (which("choco")) return "choco";
  return null;
}

export function refreshPath() {
  const extra = [
    path.join(os.homedir(), "go", "bin"),
    path.join(os.homedir(), ".cargo", "bin"),
    path.join(os.homedir(), "scoop", "shims"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python312"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python312", "Scripts"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Go", "bin"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "nodejs"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "dotnet"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "PHP"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "LLVM", "bin"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "cmd"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Eclipse Adoptium", "jdk-21.0.5.11-hotspot", "bin"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft", "jdk-21", "bin"),
  ].filter((d) => d && existsSync(d));
  if (process.platform === "win32") {
    try {
      const out = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          "[Environment]::GetEnvironmentVariable('Path','User')+';'+[Environment]::GetEnvironmentVariable('Path','Machine')",
        ],
        { encoding: "utf8", timeout: 8000, windowsHide: true },
      ).trim();
      if (out) process.env.PATH = `${out};${process.env.PATH || ""}`;
    } catch {
      /* */
    }
  }
  if (extra.length) process.env.PATH = `${extra.join(path.delimiter)}${path.delimiter}${process.env.PATH || ""}`;
}

function plan(bin) {
  const spec = INSTALL[bin];
  if (!spec) throw new Error(`Kein Installer für ${bin}`);
  const wg = which("winget");
  if (wg) {
    return {
      file: wg,
      args: [
        "install",
        "--id",
        spec.id,
        "-e",
        "--accept-package-agreements",
        "--accept-source-agreements",
        "--disable-interactivity",
        "--scope",
        "user",
      ],
      label: spec.label,
      via: "winget",
    };
  }
  const scoop = which("scoop");
  if (scoop) {
    const scoopPkg = {
      go: "go",
      rustc: "rustup",
      cargo: "rustup",
      python: "python",
      tsc: "nodejs-lts",
      dotnet: "dotnet-sdk",
      php: "php",
      ruby: "ruby",
      java: "openjdk21",
      javac: "openjdk21",
      git: "git",
    }[bin];
    if (!scoopPkg) throw new Error(`Scoop kennt ${bin} hier nicht`);
    return { file: scoop, args: ["install", scoopPkg], label: spec.label, via: "scoop" };
  }
  throw new Error("Kein Installer. Windows: App Installer (winget) aus dem Store. Bis dahin nutzt Run den Netz-Compiler.");
}

let busy = null;

export function installBin(bin) {
  const key = String(bin || "").trim();
  if (busy) return Promise.resolve({ ok: false, stderr: `Install läuft schon: ${busy}`, stdout: "", bin: key });
  let job;
  try {
    job = plan(key);
  } catch (err) {
    return Promise.resolve({
      ok: false,
      stderr: err instanceof Error ? err.message : String(err),
      stdout: "",
      bin: key,
    });
  }
  busy = key;
  return new Promise((resolve) => {
    const child = spawn(job.file, job.args, { shell: false, windowsHide: true, env: process.env });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* */
      }
    }, 12 * 60 * 1000);
    child.stdout?.on("data", (d) => {
      stdout = (stdout + d.toString("utf8")).slice(-8000);
    });
    child.stderr?.on("data", (d) => {
      stderr = (stderr + d.toString("utf8")).slice(-8000);
    });
    child.on("close", (code) => {
      clearTimeout(t);
      busy = null;
      refreshPath();
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr: stderr || (code === 0 ? "" : `${job.via} exit ${code}`),
        bin: key,
        label: job.label,
        via: job.via,
      });
    });
    child.on("error", (err) => {
      clearTimeout(t);
      busy = null;
      resolve({ ok: false, stderr: err.message, stdout, bin: key, label: job.label, via: job.via });
    });
  });
}
