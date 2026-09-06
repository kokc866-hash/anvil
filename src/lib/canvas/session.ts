import {
  CANVAS_CHANNEL,
  type CanvasBoot,
  type CanvasOperation,
  type CanvasReply,
} from "./protocol.ts";

export type CanvasFrame = { id: string; scope: string; priority: number };
type FrameOwner = CanvasFrame & {
  load: (html: string, restart?: boolean, signal?: AbortSignal) => Promise<CanvasReply>;
  command: (
    op: CanvasOperation,
    args?: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<CanvasReply>;
};
const owners = new Map<string, FrameOwner>();
let channel: BroadcastChannel | undefined;
const remoteReplies = new Map<string, (data: any) => void>();
const remoteJobs = new Map<string, AbortController>();
const discoveries = new Map<string, (frame: CanvasFrame) => void>();
const id = () => crypto.randomUUID();
export function canvasRevision(source: string) {
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < source.length; i++) {
    a = Math.imul(a ^ source.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ source.charCodeAt(i);
  }
  return `${source.length}-${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}`;
}
function bus() {
  if (channel || typeof window === "undefined" || !window.BroadcastChannel) return channel;
  channel = new window.BroadcastChannel("anvil-canvas-host-v2");
  channel.onmessage = (event) => {
    const d = event.data;
    if (!d || typeof d !== "object" || typeof d.request !== "string") return;
    if (d.kind === "discover") {
      for (const owner of owners.values())
        if (owner.scope === d.scope)
          channel?.postMessage({
            kind: "frame",
            request: d.request,
            frame: { id: owner.id, scope: owner.scope, priority: owner.priority },
          });
    } else if (d.kind === "frame") discoveries.get(d.request)?.(d.frame);
    else if (d.kind === "reply") remoteReplies.get(d.request)?.(d);
    else if (d.kind === "cancel") {
      remoteJobs.get(d.request)?.abort();
    } else if (d.kind === "command") {
      const owner = owners.get(d.target);
      if (!owner || owner.scope !== d.scope) return;
      const abort = new AbortController();
      remoteJobs.set(d.request, abort);
      const action =
        d.op === "load" && typeof d.html === "string"
          ? owner.load(d.html, d.restart === true, abort.signal)
          : owner.command(d.op, d.args, abort.signal);
      void action
        .then(
          (result) =>
            channel?.postMessage({ kind: "reply", request: d.request, from: owner.id, result }),
          (error) =>
            channel?.postMessage({
              kind: "reply",
              request: d.request,
              from: owner.id,
              error: error instanceof Error ? error.message : String(error),
            }),
        )
        .finally(() => remoteJobs.delete(d.request));
    }
  };
  return channel;
}
function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Abgebrochen", "AbortError"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("Abgebrochen", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
export async function findCanvasFrame(
  scope: string,
  waitMs = 5000,
  signal?: AbortSignal,
): Promise<CanvasFrame> {
  const until = Date.now() + waitMs;
  do {
    const candidates = [...owners.values()]
      .filter((o) => o.scope === scope)
      .map((o) => ({ id: o.id, scope, priority: o.priority }));
    const request = id();
    discoveries.set(request, (frame) => {
      if (
        frame &&
        frame.scope === scope &&
        typeof frame.id === "string" &&
        Number.isFinite(frame.priority)
      )
        candidates.push(frame);
    });
    try {
      bus()?.postMessage({ kind: "discover", request, scope });
      await delay(60, signal);
    } finally {
      discoveries.delete(request);
    }
    const found = candidates.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0];
    if (found) return found;
    if (Date.now() < until) await delay(100, signal);
  } while (Date.now() < until);
  throw new Error("Keine geöffnete Canvas-/HTML-Ausgabe für dieses Projekt.");
}
export async function canvasCommand(
  frame: CanvasFrame,
  op: CanvasOperation | "load",
  args: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<CanvasReply> {
  if (signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
  const local = owners.get(frame.id);
  if (local)
    return op === "load"
      ? local.load(String(args.html || ""), args.restart === true, signal)
      : local.command(op, args, signal);
  const transport = bus();
  if (!transport) throw new Error("Verbindung zum Run-Fenster fehlt.");
  return new Promise((resolve, reject) => {
    const request = id();
    const finish = (error?: Error, result?: CanvasReply) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      remoteReplies.delete(request);
      error ? reject(error) : resolve(result!);
    };
    const abort = () => {
      transport.postMessage({ kind: "cancel", request, target: frame.id });
      finish(new DOMException("Abgebrochen", "AbortError"));
    };
    const timer = setTimeout(
      () => finish(new Error("Run-Fenster antwortet nicht. Fenster öffnen und erneut starten.")),
      15000,
    );
    remoteReplies.set(request, (d) => {
      if (d.from !== frame.id) return;
      if (d.error) finish(new Error(String(d.error)));
      else if (d.result && typeof d.result.ok === "boolean") finish(undefined, d.result);
    });
    signal?.addEventListener("abort", abort, { once: true });
    transport.postMessage({
      kind: "command",
      request,
      target: frame.id,
      scope: frame.scope,
      op,
      args,
      ...(op === "load" ? args : {}),
    });
  });
}

export function registerCanvasFrame(
  el: HTMLIFrameElement,
  options: {
    scope: string;
    priority?: number;
    onState?: (reply: CanvasReply) => void;
    capture?: (rect: { x: number; y: number; width: number; height: number }) => Promise<string>;
  },
) {
  const ownerId = id();
  let html = "",
    boot: CanvasBoot | undefined,
    dead = false;
  let stopped: CanvasReply | undefined;
  let ready: Promise<CanvasReply> | undefined;
  let rejectLoad: ((error: Error) => void) | undefined;
  const pending = new Map<
    string,
    {
      resolve: (reply: CanvasReply) => void;
      reject: (error: Error) => void;
      clean: () => void;
      op: CanvasOperation;
    }
  >();
  const storageKey = "anvil-canvas-storage:" + canvasRevision(options.scope);
  function read(area: Storage): Record<string, string> {
    try {
      const value = JSON.parse(area.getItem(storageKey) || "{}");
      return value && typeof value === "object" && !Array.isArray(value)
        ? (Object.fromEntries(
            Object.entries(value).filter(([, v]) => typeof v === "string"),
          ) as Record<string, string>)
        : {};
    } catch {
      return {};
    }
  }
  function rejectPending(error: Error) {
    for (const p of pending.values()) {
      p.clean();
      p.reject(error);
    }
    pending.clear();
    rejectLoad?.(error);
    rejectLoad = undefined;
  }
  function message(event: MessageEvent) {
    const d = event.data;
    if (
      !boot ||
      event.source !== el.contentWindow ||
      d?.channel !== CANVAS_CHANNEL ||
      d.session !== boot.session ||
      d.revision !== boot.revision
    )
      return;
    if (d.op === "storage") {
      if (
        !["localStorage", "sessionStorage"].includes(d.area) ||
        (d.key !== null && typeof d.key !== "string") ||
        (d.value !== undefined && typeof d.value !== "string")
      )
        return;
      try {
        const area = d.area === "localStorage" ? window.localStorage : window.sessionStorage;
        const values = d.key === null ? {} : read(area);
        if (d.key !== null) {
          if (d.value === undefined) delete values[d.key];
          else
            Object.defineProperty(values, d.key, {
              configurable: true,
              enumerable: true,
              writable: true,
              value: d.value,
            });
        }
        const value = JSON.stringify(values);
        if (value.length > 256000) throw new Error("Canvas-Speicher voll.");
        area.setItem(storageKey, value);
      } catch (error) {
        options.onState?.({
          ok: false,
          state: "failed",
          error: "Canvas-Speichern fehlgeschlagen: " + String(error),
          logs: [],
          session: boot.session,
          revision: boot.revision,
        });
      }
      return;
    }
    if (typeof d.ok !== "boolean" || typeof d.state !== "string" || !Array.isArray(d.logs)) return;
    const reply: CanvasReply = {
      ok: d.ok,
      state: d.state,
      error: typeof d.error === "string" ? d.error.slice(0, 4000) : undefined,
      logs: d.logs.map(String).slice(-24),
      session: boot.session,
      revision: boot.revision,
      image: typeof d.image === "string" && d.image.startsWith("data:image/") ? d.image : undefined,
      w: Number(d.w) || undefined,
      h: Number(d.h) || undefined,
    };
    if (d.op === "state") options.onState?.(reply);
    const p = pending.get(d.request);
    if (!p || p.op !== d.op) return;
    p.clean();
    pending.delete(d.request);
    options.onState?.(reply);
    p.resolve(reply);
  }
  window.addEventListener("message", message);
  function request(
    op: CanvasOperation,
    args: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<CanvasReply> {
    if (dead || !boot || !el.contentWindow)
      return Promise.reject(new Error("Canvas-Ausgabe wurde geschlossen."));
    if (signal?.aborted) return Promise.reject(new DOMException("Abgebrochen", "AbortError"));
    const current = boot;
    return new Promise((resolve, reject) => {
      const request = id();
      const abort = () => {
        clean();
        pending.delete(request);
        reject(new DOMException("Abgebrochen", "AbortError"));
      };
      const timer = setTimeout(
        () => {
          clean();
          pending.delete(request);
          reject(
            new Error("Canvas antwortet nicht. Skript, Ladefehler oder Endlosschleife prüfen."),
          );
        },
        op === "keys-up" ? 1000 : 12000,
      );
      const clean = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      };
      pending.set(request, { resolve, reject, clean, op });
      signal?.addEventListener("abort", abort, { once: true });
      el.contentWindow!.postMessage(
        {
          ...args,
          channel: CANVAS_CHANNEL,
          session: current.session,
          revision: current.revision,
          request,
          op,
        },
        "*",
      );
    });
  }
  const owner: FrameOwner = {
    id: ownerId,
    scope: options.scope,
    priority: options.priority ?? 1,
    load(next: string, restart = false, signal?: AbortSignal) {
      if (signal?.aborted) return Promise.reject(new DOMException("Abgebrochen", "AbortError"));
      if (dead) return Promise.reject(new Error("Canvas-Ausgabe wurde geschlossen."));
      if (!restart && next === html && ready) return ready;
      rejectPending(new Error("Canvas-Lauf wurde ersetzt."));
      if (boot)
        el.contentWindow?.postMessage(
          { channel: CANVAS_CHANNEL, ...boot, request: id(), op: "dispose" },
          "*",
        );
      html = next;
      stopped = undefined;
      boot = {
        session: id(),
        revision: canvasRevision(next),
        local: read(window.localStorage),
        storage: read(window.sessionStorage),
      };
      const current = boot;
      options.onState?.({
        ok: true,
        state: "loading",
        logs: [],
        session: boot.session,
        revision: boot.revision,
      });
      const script = `<script data-anvil-session>window.__ANVIL_SESSION__=${JSON.stringify(boot).replace(/</g, "\\u003c")}</script>`;
      const source = next.replace(/<script\b[^>]*data-anvil-session[^>]*>[\s\S]*?<\/script>/gi, "");
      ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          rejectLoad = undefined;
          reject(new Error("HTML-Ausgabe wurde nicht bereit. Skripte und Ressourcen prüfen."));
        }, 14000);
        rejectLoad = (error) => {
          clearTimeout(timer);
          reject(error);
        };
        el.onload = () => {
          if (boot !== current || dead) return;
          void request("ready").then(
            (reply) => {
              clearTimeout(timer);
              rejectLoad = undefined;
              resolve(reply);
            },
            (error) => {
              clearTimeout(timer);
              rejectLoad = undefined;
              reject(error);
            },
          );
        };
        el.srcdoc = /<head\b[^>]*>/i.test(source)
          ? source.replace(/<head\b[^>]*>/i, (m) => m + script)
          : script + source;
      });
      // React's live preview also observes failures; no unhandled rejection on teardown.
      void ready.catch((error) => {
        if (boot === current && !dead && !stopped)
          options.onState?.({
            ok: false,
            state: "failed",
            error: String(error.message || error),
            logs: [],
            session: current.session,
            revision: current.revision,
          });
      });
      const operation = ready;
      if (signal) {
        const abort = () => {
          if (boot === current && !dead) void owner.command("stop");
        };
        signal.addEventListener("abort", abort, { once: true });
        const done = operation;
        void done.then(
          () => signal.removeEventListener("abort", abort),
          () => signal.removeEventListener("abort", abort),
        );
        if (signal.aborted) abort();
      }
      return operation;
    },
    async command(op, args = {}, signal) {
      if (typeof args.expectedSession === "string" && args.expectedSession !== boot?.session)
        throw new Error("Canvas-Lauf wurde ersetzt; Befehl verworfen.");
      if (op === "stop" && boot) {
        stopped = {
          ok: true,
          state: "stopped",
          logs: [],
          session: boot.session,
          revision: boot.revision,
        };
        rejectPending(new Error("Canvas-Lauf wurde gestoppt."));
        el.onload = null;
        el.srcdoc =
          '<!doctype html><html><body style="background:#0a0a0b;color:#aaa;font:14px system-ui">Gestoppt. Run startet neu.</body></html>';
        ready = Promise.resolve(stopped);
        options.onState?.(stopped);
        return stopped;
      }
      if (stopped)
        return { ...stopped, ok: false, error: "Canvas-Lauf wurde gestoppt. Mit Run neu starten." };
      if (op !== "keys-up" && op !== "dispose") await ready;
      if (signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
      if (typeof args.expectedSession === "string" && args.expectedSession !== boot?.session)
        throw new Error("Canvas-Lauf wurde ersetzt; Befehl verworfen.");
      const current = boot;
      if (op === "shot" && options.capture) {
        const status = await request("ready", {}, signal);
        const rect = el.getBoundingClientRect();
        const image = await options.capture({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        });
        if (current !== boot || dead)
          throw new Error("Canvas-Lauf wurde während der Aufnahme ersetzt.");
        return { ...status, image, w: Math.round(rect.width), h: Math.round(rect.height) };
      }
      return request(op, args, signal);
    },
  };
  owners.set(owner.id, owner);
  bus();
  return {
    load: owner.load,
    command: owner.command,
    dispose() {
      if (dead) return;
      if (boot)
        el.contentWindow?.postMessage(
          { channel: CANVAS_CHANNEL, ...boot, request: id(), op: "dispose" },
          "*",
        );
      dead = true;
      owners.delete(owner.id);
      rejectPending(new Error("Canvas-Ausgabe wurde geschlossen."));
      window.removeEventListener("message", message);
      el.onload = null;
      el.removeAttribute("srcdoc");
      el.src = "about:blank";
    },
  };
}
