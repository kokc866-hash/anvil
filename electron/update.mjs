import { app, dialog, shell } from "electron";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { handleOnce } from "./ipc.mjs";
import { cmpVer, pickAssets } from "./update-parse.mjs";

const REPO = "kokc866-hash/anvil";

export { cmpVer, pickAssets };

export async function fetchLatest() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const j = await res.json();
  const latest = String(j.tag_name || "").replace(/^v/i, "");
  const current = app.getVersion();
  return {
    ok: true,
    latest,
    current,
    newer: cmpVer(latest, current) > 0,
    name: String(j.name || `Anvil ${latest}`),
    notes: String(j.body || "").slice(0, 1200),
    htmlUrl: String(j.html_url || `https://github.com/${REPO}/releases/latest`),
    ...pickAssets(j.assets),
  };
}

async function downloadFile(url, dest) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(180000) });
  if (!res.ok || !res.body) throw new Error(`Download ${res.status}`);
  mkdirSync(join(dest, ".."), { recursive: true });
  const out = createWriteStream(dest);
  await pipeline(Readable.fromWeb(res.body), out);
  return dest;
}

async function pickDir(title) {
  const r = await dialog.showOpenDialog({
    title: title || "ZIP-Ordner",
    properties: ["openDirectory", "createDirectory"],
  });
  if (r.canceled || !r.filePaths[0]) return "";
  return r.filePaths[0];
}

function extractZip(zip, dest) {
  mkdirSync(dest, { recursive: true });
  return new Promise((resolve, reject) => {
    const child =
      process.platform === "win32"
        ? spawn(
            "powershell.exe",
            [
              "-NoProfile",
              "-Command",
              `Expand-Archive -LiteralPath '${String(zip).replace(/'/g, "''")}' -DestinationPath '${String(dest).replace(/'/g, "''")}' -Force`,
            ],
            { windowsHide: true, stdio: "ignore" },
          )
        : spawn("unzip", ["-o", zip, "-d", dest], { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(dest);
      else reject(new Error("Entpacken fehlgeschlagen"));
    });
  });
}

export function bindUpdateIpc() {
  handleOnce("update-check", async () => {
    try {
      return await fetchLatest();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Update-Prüfung fehlgeschlagen" };
    }
  });
  handleOnce("update-zip", async () => {
    try {
      const info = await fetchLatest();
      if (!info.zipUrl) throw new Error("Kein ZIP im Release.");
      const dir = await pickDir("Anvil ZIP hier entpacken");
      if (!dir) return { ok: false, canceled: true };
      const zip = join(tmpdir(), info.zipName || "Anvil.zip");
      await downloadFile(info.zipUrl, zip);
      await extractZip(zip, dir);
      return { ok: true, dir, latest: info.latest };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "ZIP fehlgeschlagen" };
    }
  });
  handleOnce("update-setup", async () => {
    try {
      const info = await fetchLatest();
      if (!info.setupUrl) throw new Error("Kein Setup im Release.");
      const dest = join(tmpdir(), info.setupName || "Anvil.Setup.exe");
      await downloadFile(info.setupUrl, dest);
      if (process.platform === "win32") {
        spawn(dest, [], { detached: true, stdio: "ignore" }).unref();
      } else {
        await shell.openPath(dest);
      }
      return { ok: true, path: dest, latest: info.latest };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Setup fehlgeschlagen" };
    }
  });
  handleOnce("update-open", async (_e, url) => {
    const u = String(url || "");
    if (!/^https:\/\/github\.com\//i.test(u)) return false;
    await shell.openExternal(u);
    return true;
  });
}

export function findAnvilExe(dir) {
  const names = ["Anvil.exe", "anvil.exe"];
  for (const n of names) {
    const p = join(dir, n);
    if (existsSync(p)) return p;
  }
  return "";
}
