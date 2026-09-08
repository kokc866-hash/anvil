import { app, safeStorage, shell } from "electron";
import { readFile, mkdir, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { handleOnce } from "./ipc.mjs";
import { McpHost, mcpConfig } from "./mcp-host.mjs";
import { McpOAuth } from "./mcp-oauth.mjs";

const owners = new Map();
let records;
let writes = Promise.resolve();
const vaultPath = () => join(app.getPath("userData"), "mcp-oauth.enc");
function protectedStorage() {
  return (
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text")
  );
}
async function loadVault() {
  if (records) return records;
  try {
    const data = await readFile(vaultPath());
    if (!protectedStorage()) throw new Error("MCP-Schlüsselspeicher gesperrt.");
    const value = JSON.parse(safeStorage.decryptString(data));
    if (value.version !== 1 || !value.records || typeof value.records !== "object")
      throw new Error("MCP-Schlüsselformat ungültig.");
    records = value.records;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    records = {};
  }
  return records;
}
async function readCredential(key) {
  await writes;
  return (await loadVault())[key];
}
function writeCredential(key, value) {
  const task = writes.then(async () => {
    const next = { ...(await loadVault()) };
    if (value === undefined) delete next[key];
    else next[key] = value;
    if (!protectedStorage())
      throw new Error(
        "MCP-Anmeldung kann nicht sicher gespeichert werden: Betriebssystem-Schlüsselspeicher nicht verfügbar.",
      );
    const target = vaultPath(),
      temp = `${target}.${randomUUID()}.tmp`;
    try {
      await mkdir(app.getPath("userData"), { recursive: true });
      await writeFile(
        temp,
        safeStorage.encryptString(JSON.stringify({ version: 1, records: next })),
        { mode: 0o600, flag: "wx" },
      );
      await rename(temp, target);
      records = next;
    } finally {
      await rm(temp, { force: true }).catch(() => {});
    }
  });
  writes = task.catch(() => {});
  return task;
}

export async function stopMcpConnections() {
  await Promise.allSettled(
    [...owners.values()].map(async ({ host, jobs }) => {
      for (const job of jobs.values()) job.controller.abort();
      await host.stop();
    }),
  );
  owners.clear();
}

export function bindMcpIpc(isTrusted) {
  const trusted = (e) =>
    e.senderFrame && e.senderFrame === e.sender.mainFrame && isTrusted?.(e.senderFrame.url);
  function ownerFor(owner) {
    let state = owners.get(owner.id);
    if (state) return state;
    const emit = (value) => {
      if (!owner.isDestroyed()) owner.send("mcp-event", value);
    };
    const oauth = new McpOAuth({
      read: readCredential,
      write: writeCredential,
      open: (url) => shell.openExternal(url),
    });
    state = {
      host: new McpHost({ version: app.getVersion(), emit, oauth }),
      jobs: new Map(),
      oauth,
    };
    owners.set(owner.id, state);
    const stop = () => {
      for (const job of state.jobs.values()) job.controller.abort();
      void state.host.stop();
      if (owners.get(owner.id) === state) owners.delete(owner.id);
      owner.off("destroyed", stop);
      owner.off("did-start-navigation", navigate);
    };
    const navigate = (_e, _url, _inPlace, mainFrame) => { if (mainFrame) stop(); };
    owner.once("destroyed", stop);
    owner.on("did-start-navigation", navigate);
    return state;
  }
  handleOnce("mcp-request", async (e, request) => {
    if (!trusted(e)) return { ok: false, error: "MCP nur im Anvil-Hauptfenster verfügbar." };
    const state = ownerFor(e.sender);
    const id = request?.id;
    if (
      typeof id !== "string" ||
      !/^[\w-]{1,80}$/.test(id) ||
      state.jobs.has(id) ||
      state.jobs.size >= 16
    )
      return { ok: false, error: "Ungültige oder bereits laufende MCP-Anfrage." };
    const controller = new AbortController();
    try {
      const config = mcpConfig(request.server);
      state.jobs.set(id, { controller, server: config.id });
      let value;
      if (request.method === "oauth/login" || request.method === "oauth/logout") {
        if (config.transport !== "http") throw new Error("OAuth benötigt HTTP.");
        await state.host.close(config.id);
        value =
          request.method === "oauth/login"
            ? await state.oauth.login(config, controller.signal)
            : await state.oauth.logout(config);
      } else
        value = await state.host.request(config, request.method, request.params, {
          signal: controller.signal,
          onProgress: (params) => {
            if (!controller.signal.aborted && !e.sender.isDestroyed())
              e.sender.send("mcp-event", { id, server: config.id, kind: "progress", params });
          },
        });
      controller.signal.throwIfAborted();
      return { ok: true, value };
    } catch (error) {
      return {
        ok: false,
        error: controller.signal.aborted ? "MCP abgebrochen." : error.message || String(error),
      };
    } finally {
      state.jobs.delete(id);
    }
  });
  handleOnce("mcp-cancel", (e, id) => {
    if (!trusted(e)) return false;
    owners.get(e.sender.id)?.jobs.get(id)?.controller.abort();
    return true;
  });
  handleOnce("mcp-close", async (e, id) => {
    if (!trusted(e)) return false;
    const state = owners.get(e.sender.id);
    if (!state) return true;
    for (const job of state.jobs.values()) if (job.server === id) job.controller.abort();
    await state.host.close(id);
    return true;
  });
}
