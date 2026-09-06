import { app, BrowserWindow, safeStorage } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { handleOnce, onSync } from "./ipc.mjs";

const empty = () => ({ llmApiKey: "", githubToken: "", companionToken: "", keys: {}, vault: [] });
let secrets = empty();
let loaded = false;
let locked = false;
let migrated = false;
let revision = 0;
let pending = 0;
let writes = Promise.resolve();
const references = new Map();
const reverse = new Map();
const path = () => join(app.getPath("userData"), "secrets.enc");

function protectedStorage() {
  return (
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text")
  );
}

function normalize(value) {
  const out = empty();
  if (!value || typeof value !== "object") return out;
  for (const key of ["llmApiKey", "githubToken", "companionToken"]) {
    if (typeof value[key] === "string") out[key] = value[key];
  }
  if (value.keys && typeof value.keys === "object" && !Array.isArray(value.keys)) {
    out.keys = Object.fromEntries(
      Object.entries(value.keys).filter(
        ([key, secret]) => key !== "__proto__" && typeof secret === "string",
      ),
    );
  }
  if (Array.isArray(value.vault))
    out.vault = value.vault.filter(
      (entry) =>
        entry &&
        typeof entry.id === "string" &&
        typeof entry.name === "string" &&
        typeof entry.value === "string",
    );
  return out;
}

function load() {
  if (loaded) return;
  loaded = true;
  if (!existsSync(path())) return;
  try {
    if (!protectedStorage()) throw new Error("Schlüsselspeicher gesperrt");
    const record = JSON.parse(safeStorage.decryptString(readFileSync(path())));
    if (record.version !== 1 || !record.secrets || typeof record.secrets !== "object")
      throw new Error("Unbekanntes Schlüsselformat");
    secrets = normalize(record.secrets);
    migrated = record.browserMigrated === true;
  } catch {
    locked = true;
  }
}

function snapshot() {
  load();
  const values = new Set([secrets.llmApiKey, ...Object.values(secrets.keys)].filter(Boolean));
  for (const [ref, value] of references)
    if (!values.has(value)) {
      references.delete(ref);
      reverse.delete(value);
    }
  for (const value of values)
    if (!reverse.has(value)) {
      const ref = randomBytes(24).toString("hex");
      references.set(ref, value);
      reverse.set(value, ref);
    }
  return {
    ok: !locked,
    persistent: !locked && protectedStorage(),
    browserMigrated: migrated,
    revision,
    secrets,
    credentials: [...references].map(([ref, value]) => ({ ref, value })),
    error: locked
      ? "Gespeicherte Schlüssel sind gesperrt. Die verschlüsselte Datei bleibt erhalten."
      : "",
  };
}

async function writeRecord(next, browserMigrated) {
  const data = safeStorage.encryptString(
    JSON.stringify({ version: 1, browserMigrated, secrets: next }),
  );
  const temporary = `${path()}.${randomBytes(8).toString("hex")}.tmp`;
  await mkdir(app.getPath("userData"), { recursive: true });
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(data);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path());
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function trusted(event, allowUrl) {
  return (
    event.senderFrame &&
    event.senderFrame === event.sender.mainFrame &&
    allowUrl(event.senderFrame.url)
  );
}

export function bindSecretsIpc(allowUrl) {
  load();
  onSync("secrets-load-sync", (event) => {
    if (!trusted(event, allowUrl)) throw new Error("Schlüsselzugriff nicht erlaubt.");
    return snapshot();
  });
  handleOnce("secrets-save", (event, partial, options = {}) => {
    if (!trusted(event, allowUrl)) throw new Error("Schlüsselzugriff nicht erlaubt.");
    // Validate before queueing, keeping arbitrary IPC input out of the stored record.
    if (!partial || typeof partial !== "object" || Array.isArray(partial))
      throw new Error("Ungültige Schlüsseländerung.");
    if (JSON.stringify(partial).length > 4_000_000)
      throw new Error("Schlüsseleintrag ist zu groß.");
    pending++;
    const operation = writes
      .catch(() => undefined)
      .then(async () => {
        if (locked)
          throw new Error(
            "Schlüsselspeicher gesperrt; vorhandene Daten werden nicht überschrieben.",
          );
        const patch = normalize(partial);
        const next = { ...secrets };
        for (const key of ["llmApiKey", "githubToken", "companionToken"])
          if (key in partial) next[key] = patch[key];
        if (partial.keys) next.keys = { ...secrets.keys, ...patch.keys };
        if (partial.vault) next.vault = patch.vault;
        const nextMigrated = migrated || options.migrate === true;
        if (protectedStorage()) await writeRecord(next, nextMigrated);
        secrets = next;
        migrated = nextMigrated;
        revision++;
        const state = snapshot();
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed() && allowUrl(window.webContents.getURL()))
            window.webContents.send("secrets-changed", state);
        }
        return state;
      })
      .finally(() => {
        pending--;
      });
    writes = operation;
    return operation;
  });
  let quitting = false;
  app.on("before-quit", (event) => {
    if (!pending || quitting) return;
    event.preventDefault();
    quitting = true;
    void writes.catch(() => undefined).finally(() => app.quit());
  });
}

/** Only the native transport resolves these references into actual HTTP headers. */
export function resolveCredentialHeaders(headers, encoded) {
  if (!encoded) return headers;
  const requested = JSON.parse(String(encoded));
  if (!requested || typeof requested !== "object" || Array.isArray(requested))
    throw new Error("Ungültiger Schlüsselverweis.");
  const out = { ...headers };
  for (const [header, entry] of Object.entries(requested)) {
    if (
      !["authorization", "x-api-key", "api-key"].includes(header) ||
      !entry ||
      !["bearer", "raw"].includes(entry.scheme)
    )
      throw new Error("Ungültiger Schlüsselverweis.");
    const value = references.get(entry.ref);
    if (!value) throw new Error("Schlüssel wurde geändert. Anfrage erneut senden.");
    out[header] = entry.scheme === "bearer" ? `Bearer ${value}` : value;
  }
  return out;
}
