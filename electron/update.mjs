import { app, dialog, shell } from "electron";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { handleOnce } from "./ipc.mjs";
import { cmpVer, pickAssets } from "./update-parse.mjs";
import { assetName, updateUrl, verifyDigest, assertEmptyDestination } from "./update-safety.mjs";

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

async function downloadFile(url, dest, digest) {
  if (!/^sha256:[a-f0-9]{64}$/i.test(digest)) throw new Error("Release liefert keine SHA-256-Pruefsumme. Bitte die Release-Seite pruefen.");
  const res = await fetch(updateUrl(url), { redirect: "follow", signal: AbortSignal.timeout(180000) });
  if (!res.ok || !res.body) throw new Error(`Download ${res.status}`);
  mkdirSync(join(dest, ".."), { recursive: true });
  const out = createWriteStream(dest);
  try {
    await pipeline(Readable.fromWeb(res.body), out);
    await verifyDigest(dest, digest);
  } catch (error) { await rm(dest, { force: true }); throw error; }
  return dest;
}

async function downloadDestination(name) {
  const root = join(app.getPath("userData"), "updates");
  mkdirSync(root, { recursive: true });
  return join(await mkdtemp(join(root, "download-")), assetName(name));
}

async function verifyPublisher(file) {
  const config = JSON.parse(readFileSync(new URL("../product-release.json", import.meta.url), "utf8"));
  const subject = String(config.signing?.subjectName || "");
  if (!subject) return false;
  if (process.platform !== "win32") throw new Error("Setup-Signatur kann nur unter Windows geprueft werden.");
  const quote = value => `'${value.replace(/'/g, "''")}'`;
  const command = `$s=Get-AuthenticodeSignature -LiteralPath ${quote(file)}; if($s.Status -ne 'Valid' -or -not $s.TimeStamperCertificate){exit 1}; $n=$s.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false); if($n -cne ${quote(subject)}){exit 2}`;
  await new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")], { windowsHide: true, stdio: "ignore" });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error("Setup-Signatur oder Herausgeber stimmt nicht. Datei wird nicht geoeffnet.")));
  });
  return true;
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

export function bindUpdateIpc(isTrusted) {
  const trusted = event => event.senderFrame && event.senderFrame === event.sender.mainFrame && isTrusted?.(event.senderFrame.url);
  const denied = () => ({ ok: false, error: "Updates nur im Anvil-Hauptfenster verfuegbar." });
  let downloading = false;
  handleOnce("update-check", async (event) => {
    if (!trusted(event)) return denied();
    try {
      return await fetchLatest();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Update-Prüfung fehlgeschlagen" };
    }
  });
  handleOnce("update-zip", async (event) => {
    if (!trusted(event)) return denied();
    if (downloading) return { ok: false, error: "Ein Update-Download laeuft bereits." };
    downloading = true;
    try {
      const info = await fetchLatest();
      if (!info.zipUrl) throw new Error("Kein ZIP im Release.");
      const dir = await pickDir("Anvil ZIP hier entpacken");
      if (!dir) return { ok: false, canceled: true };
      assertEmptyDestination(dir);
      const zip = await downloadDestination(info.zipName || "Anvil.zip");
      await downloadFile(info.zipUrl, zip, info.zipDigest);
      assertEmptyDestination(dir);
      await extractZip(zip, dir);
      return { ok: true, dir, latest: info.latest };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "ZIP fehlgeschlagen" };
    } finally { downloading = false; }
  });
  handleOnce("update-setup", async (event) => {
    if (!trusted(event)) return denied();
    if (downloading) return { ok: false, error: "Ein Update-Download laeuft bereits." };
    downloading = true;
    try {
      const info = await fetchLatest();
      if (!info.setupUrl) throw new Error("Kein Setup im Release.");
      const dest = await downloadDestination(info.setupName || "Anvil.Setup.exe");
      await downloadFile(info.setupUrl, dest, info.setupDigest);
      const publisherVerified = await verifyPublisher(dest);
      shell.showItemInFolder(dest);
      return { ok: true, path: dest, latest: info.latest, message: `Setup heruntergeladen. ${publisherVerified ? "Herausgeber-Signatur geprueft. " : "Herausgeber ist in dieser lokalen Ausgabe noch nicht konfiguriert; Signatur nicht bestaetigt. "}Arbeit speichern, Anvil schliessen und dann das Setup oeffnen.` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Setup fehlgeschlagen" };
    } finally { downloading = false; }
  });
  handleOnce("update-open", async (_e, url) => {
    if (!trusted(_e)) return false;
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
