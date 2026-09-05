import { handleOnce } from "./ipc.mjs";
import { CLI_KINDS, completeCli, loginCli, probeCli } from "./cli-runner.mjs";

const active = new Map();

export function stopCliJobs() {
  for (const job of active.values()) job.abort();
  active.clear();
}

export function bindCliIpc(isTrusted) {
  async function job(event, request, action) {
    if (!isTrusted?.(event.senderFrame?.url))
      return { ok: false, error: "CLI nur im Anvil-Hauptfenster verfügbar." };
    const { id, kind } = request ?? {};
    if (typeof id !== "string" || !/^[\w-]{1,80}$/.test(id) || !CLI_KINDS.includes(kind))
      return { ok: false, error: "Ungültige CLI-Anfrage." };
    const owner = event.sender;
    const key = `${owner.id}:${id}`;
    if (active.has(key) || active.size >= 8)
      return { ok: false, error: "CLI bereits beschäftigt." };
    const controller = new AbortController();
    active.set(key, controller);
    const abort = () => controller.abort();
    owner.once("destroyed", abort);
    const navigate = (_e, _url, _inPlace, mainFrame) => {
      if (mainFrame) abort();
    };
    owner.on("did-start-navigation", navigate);
    let lastBeat = 0;
    const emit = (text) => {
      if (owner.isDestroyed() || controller.signal.aborted) return;
      if (!text && Date.now() - lastBeat < 200) return;
      lastBeat = Date.now();
      owner.send("cli-event", { id, text });
    };
    try {
      const options = {
        signal: controller.signal,
        onOutput: emit,
        onActivity: () => emit(),
        timeoutMs: Math.min(480 * 60000, Math.max(0, Number(request.timeoutMs) || 0)),
      };
      const value =
        action === "run"
          ? await completeCli(request, options)
          : action === "login"
            ? await loginCli(kind, options)
            : await probeCli(kind, controller.signal);
      return { ok: true, value };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "CLI fehlgeschlagen." };
    } finally {
      active.delete(key);
      owner.off("destroyed", abort);
      owner.off("did-start-navigation", navigate);
    }
  }
  handleOnce("cli-probe", (e, r) => job(e, r, "probe"));
  handleOnce("cli-login", (e, r) => job(e, r, "login"));
  handleOnce("cli-run", (e, r) => job(e, r, "run"));
  handleOnce("cli-cancel", (e, id) => {
    active.get(`${e.sender.id}:${id}`)?.abort();
    return true;
  });
}
