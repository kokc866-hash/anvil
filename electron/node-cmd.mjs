import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

export function findSystemNode() {
  const skip = (p) => !p || /electron/i.test(p);
  const fromNpm = process.env.npm_node_execpath;
  if (!skip(fromNpm) && existsSync(fromNpm)) return fromNpm;
  try {
    const cmd = process.platform === "win32" ? "where node" : "command -v node";
    const out = execSync(cmd, { encoding: "utf8" }).trim().split(/\r?\n/)[0];
    if (!skip(out) && existsSync(out)) return out;
  } catch {
    /* */
  }
  return "";
}

/** Packaged exe has no Node on PATH — run scripts with Electron as Node. */
export function nodeCommand({ isPackaged, execPath }) {
  if (isPackaged) return { file: execPath, electronAsNode: true };
  const sys = findSystemNode();
  if (sys) return { file: sys, electronAsNode: false };
  if (execPath) return { file: execPath, electronAsNode: true };
  return { file: "node", electronAsNode: false };
}

export function withNodeEnv(base, electronAsNode) {
  const env = { ...base };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ASAR;
  if (electronAsNode) env.ELECTRON_RUN_AS_NODE = "1";
  return env;
}
