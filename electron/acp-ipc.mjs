import { mkdtemp, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { handleOnce } from "./ipc.mjs";
import { probeAcp } from "./acp-client.mjs";

const active = new Map();
export function stopAcpJobs() {
  for (const job of active.values()) job.abort();
}
export function bindAcpIpc(isTrusted, dataDir) {
  handleOnce("acp-probe", async (event, request) => {
    if (
      !event.senderFrame ||
      event.senderFrame !== event.sender.mainFrame ||
      !isTrusted(event.senderFrame.url)
    )
      return { ok: false, error: "ACP nur im Anvil-Hauptfenster verfügbar." };
    const owner = event.sender,
      id = request?.id;
    if (typeof id !== "string" || !/^[\w-]{1,80}$/.test(id) || active.has(owner.id))
      return { ok: false, error: "ACP bereits beschäftigt oder Anfrage ungültig." };
    const controller = new AbortController();
    active.set(owner.id, controller);
    const abort = () => controller.abort();
    const navigate = (_e, _url, _inPlace, main) => {
      if (main) abort();
    };
    owner.once("destroyed", abort);
    owner.on("did-start-navigation", navigate);
    let cwd;
    try {
      cwd = await mkdtemp(join(dataDir, "acp-probe-"));
      const value = await probeAcp({
        command: request.command,
        args: request.args,
        cwd,
        signal: controller.signal,
      });
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      active.delete(owner.id);
      owner.off("destroyed", abort);
      owner.off("did-start-navigation", navigate);
      // Only remove an empty, dedicated probe directory. Agent-created files are retained.
      if (cwd) await rmdir(cwd).catch(() => {});
    }
  });
  handleOnce("acp-cancel", (event) => {
    active.get(event.sender.id)?.abort();
    return true;
  });
}
