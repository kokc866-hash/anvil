import type { CanvasRuntime } from "./runtime";
import type { CanvasInput } from "./input";
import type { CanvasBoot, CanvasOperation, CanvasReply, CanvasState } from "./protocol";

/** Guest side. Never trusts a frame name, wildcard sender, or an old run's response. */
export function installCanvasBridge(
  win: Window & typeof globalThis,
  inputs: CanvasInput,
  runtime: CanvasRuntime,
) {
  const boot = (win as unknown as { __ANVIL_SESSION__?: CanvasBoot }).__ANVIL_SESSION__;
  const channel = "anvil-canvas-v2";
  const logs: string[] = [];
  let failure = "",
    loaded = false,
    stopped = false,
    disposed = false;
  const off: (() => void)[] = [];
  const send = (data: Record<string, unknown>) => {
    if (boot)
      win.parent.postMessage(
        { channel, session: boot.session, revision: boot.revision, ...data },
        "*",
      );
  };
  const listen = (name: string, fn: EventListener, capture = false) => {
    win.addEventListener(name, fn, capture);
    off.push(() => win.removeEventListener(name, fn, capture));
  };
  function log(level: string, text: string) {
    const message = text.slice(0, 2000);
    logs.push(level + ": " + message);
    if (logs.length > 80) logs.shift();
    if (level === "error") {
      failure ||= message;
      send({ op: "state", ...status() });
    }
  }
  for (const name of ["log", "warn", "error"] as const) {
    const original = win.console[name];
    const wrapper = (...values: unknown[]) => {
      log(
        name,
        values
          .map((v) =>
            v instanceof Error
              ? v.stack || v.message
              : typeof v === "string"
                ? v
                : (() => {
                    try {
                      return JSON.stringify(v);
                    } catch {
                      return String(v);
                    }
                  })(),
          )
          .join(" "),
      );
      original.apply(win.console, values);
    };
    win.console[name] = wrapper;
    off.push(() => {
      if (win.console[name] === wrapper) win.console[name] = original;
    });
  }
  listen(
    "error",
    ((event: ErrorEvent) => {
      if (event.message)
        log(
          "error",
          `${event.message}${event.filename ? ` (${event.filename.slice(0, 200)}:${event.lineno})` : ""}`,
        );
      else {
        const el = event.target as HTMLScriptElement;
        log(
          "error",
          "Datei konnte nicht geladen werden: " +
            (el?.getAttribute?.("data-anvil-src") ||
              el?.getAttribute?.("src") ||
              el?.getAttribute?.("href") ||
              el?.tagName ||
              "unbekannt"),
        );
      }
    }) as EventListener,
    true,
  );
  listen("securitypolicyviolation", ((event: SecurityPolicyViolationEvent) =>
    log(
      "error",
      `Content-Security-Policy blockiert ${event.effectiveDirective}: ${event.blockedURI}`,
    )) as EventListener);
  listen("unhandledrejection", ((event: PromiseRejectionEvent) =>
    log("error", event.reason?.message || String(event.reason))) as EventListener);
  listen("anvil-runtime-error", ((event: CustomEvent) =>
    log("error", String(event.detail))) as EventListener);
  listen("anvil-runtime-state", (() => send({ op: "state", ...status() })) as EventListener);
  listen("pagehide", (() => dispose()) as EventListener);
  function storage(name: "localStorage" | "sessionStorage", initial: Record<string, string>) {
    let values = { ...initial };
    const notify = (key: string | null, value?: string) =>
      send({ op: "storage", area: name, key, value });
    const fake: Storage = {
      get length() {
        return Object.keys(values).length;
      },
      key(index) {
        return Object.keys(values)[index] ?? null;
      },
      getItem(key) {
        return Object.hasOwn(values, String(key)) ? values[String(key)] : null;
      },
      setItem(key, value) {
        key = String(key);
        value = String(value);
        const next = { ...values, [key]: value };
        if (JSON.stringify(next).length > 256_000)
          throw new win.DOMException("Canvas-Speicher voll (256 KB).", "QuotaExceededError");
        values = next;
        notify(key, value);
      },
      removeItem(key) {
        key = String(key);
        delete values[key];
        notify(key);
      },
      clear() {
        values = {};
        notify(null);
      },
    };
    try {
      Object.defineProperty(win, name, {
        configurable: true,
        value: new Proxy(fake, {
          get(target, key) {
            return typeof key === "string" && !(key in target)
              ? (target.getItem(key) ?? undefined)
              : Reflect.get(target, key);
          },
          set(target, key, value) {
            if (typeof key !== "string") return false;
            target.setItem(key, String(value));
            return true;
          },
          deleteProperty(target, key) {
            if (typeof key === "string") target.removeItem(key);
            return true;
          },
        }),
      });
    } catch {
      log("warn", "Canvas-Speicher nicht verfügbar: " + name);
    }
  }
  if (boot) {
    storage("localStorage", boot.local);
    storage("sessionStorage", boot.storage);
  } else {
    for (const name of ["localStorage", "sessionStorage"] as const) {
      try {
        void win[name].length;
      } catch {
        storage(name, {});
      }
    }
  }
  function status(): Omit<CanvasReply, "session" | "revision"> {
    const current = runtime.status();
    const state: CanvasState = disposed
      ? "disposed"
      : failure || current.state === "failed"
        ? "failed"
        : stopped
          ? "stopped"
          : loaded
            ? (current.state as CanvasState)
            : "loading";
    return {
      ok: !failure && state !== "failed" && state !== "disposed",
      state,
      error: failure || current.error || undefined,
      logs: logs.slice(-24),
    };
  }
  const pageLoaded = new Promise<void>((resolve) => {
    if (win.document.readyState === "complete") resolve();
    else win.addEventListener("load", () => resolve(), { once: true });
  });
  const ready = pageLoaded
    .then(async () => {
      await win.document.fonts?.ready;
      await Promise.all(
        Array.from(win.document.images).map(async (image) => {
          if (!image.complete)
            await new Promise<void>((resolve, reject) => {
              image.addEventListener("load", () => resolve(), { once: true });
              image.addEventListener(
                "error",
                () =>
                  reject(
                    new Error("Bild konnte nicht geladen werden: " + image.getAttribute("src")),
                  ),
                { once: true },
              );
            });
          if (image.src && !image.naturalWidth)
            throw new Error("Bild konnte nicht geladen werden: " + image.getAttribute("src"));
        }),
      );
      await runtime.ready();
      await new Promise<void>((resolve) =>
        win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve())),
      );
      loaded = true;
      send({ op: "state", ...status() });
    })
    .catch((error) => {
      loaded = true;
      log("error", error instanceof Error ? error.message : String(error));
    });
  async function snapshot() {
    await ready;
    await runtime.ready();
    const w = Math.max(1, win.innerWidth),
      h = Math.max(1, win.innerHeight);
    const canvases = [...win.document.querySelectorAll("canvas")].filter(
      (c) => c.getBoundingClientRect().width > 0,
    );
    // Preserve all DOM controls and canvases; rasterize only on an explicit request.
    const clone = win.document.documentElement.cloneNode(true) as HTMLElement;
    const originals = [
      win.document.documentElement,
      ...win.document.documentElement.querySelectorAll("*"),
    ];
    const copies = [clone, ...clone.querySelectorAll("*")];
    if (originals.length > 6000)
      throw new Error(
        "HTML-Aufnahme zu groß. Die Desktop-Ausgabe kann die sichtbare Fläche direkt aufnehmen.",
      );
    const resources = new Map<string, Promise<string>>();
    function embed(src: string) {
      if (!src || /^(data:|#)/i.test(src)) return Promise.resolve(src);
      if (!resources.has(src))
        resources.set(
          src,
          (async () => {
            try {
              const response = await win.fetch(src, { signal: win.AbortSignal.timeout(8000) });
              if (!response.ok) throw new Error("HTTP " + response.status);
              const blob = await response.blob();
              if (blob.size > 10_000_000) throw new Error("Ressource größer als 10 MB");
              return await new Promise<string>((resolve, reject) => {
                const reader = new win.FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
              });
            } catch {
              throw new Error(
                "HTML-Aufnahme blockiert: Externes Bild oder CSS-Ressource nicht abrufbar (CORS/Pfad). Die Desktop-Ausgabe kann die sichtbare Fläche direkt aufnehmen.",
              );
            }
          })(),
        );
      return resources.get(src)!;
    }
    await Promise.all(
      originals.map(async (original, i) => {
        const copy = copies[i] as HTMLElement;
        if (original instanceof win.HTMLCanvasElement) {
          const image = win.document.createElement("img");
          try {
            image.src = original.toDataURL("image/png");
          } catch {
            throw new Error(
              "Aufnahme blockiert: Ein Canvas enthält externe Bilder ohne CORS-Freigabe.",
            );
          }
          const style = win.getComputedStyle(original);
          image.style.cssText = Array.from(style)
            .map((k) => `${k}:${style.getPropertyValue(k)};`)
            .join("");
          image.width = original.clientWidth;
          image.height = original.clientHeight;
          copy.replaceWith(image);
          return;
        }
        if (copy.style) {
          const style = win.getComputedStyle(original);
          copy.style.cssText = Array.from(style)
            .map((k) => `${k}:${style.getPropertyValue(k)};`)
            .join("");
        }
        if (original instanceof win.HTMLImageElement) {
          copy.setAttribute("src", await embed(original.currentSrc || original.src));
          copy.removeAttribute("srcset");
          copy.removeAttribute("loading");
        }
        if (copy.style) {
          const css = copy.style.cssText;
          const urls = [...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)];
          let embedded = css;
          for (const match of urls)
            embedded = embedded.replace(
              match[0],
              "url(" + JSON.stringify(await embed((match[1] ?? match[2] ?? match[3]).trim())) + ")",
            );
          copy.style.cssText = embedded;
        }
        if (original instanceof win.HTMLInputElement) {
          copy.setAttribute("value", original.type === "password" ? "" : original.value);
          if (original.checked) copy.setAttribute("checked", "");
          else copy.removeAttribute("checked");
        }
        if (original instanceof win.HTMLTextAreaElement) copy.textContent = original.value;
        if (original instanceof win.HTMLSelectElement)
          [...copy.querySelectorAll("option")].forEach((option, j) =>
            option.toggleAttribute("selected", original.options[j].selected),
          );
      }),
    );
    clone.querySelectorAll("script,link,meta,iframe,object,embed").forEach((el) => el.remove());
    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    const body = clone.querySelector("body");
    if (body) {
      body.style.margin = win.getComputedStyle(win.document.body).margin;
      body.style.transform = `translate(${-win.scrollX}px,${-win.scrollY}px)`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">${new win.XMLSerializer().serializeToString(clone)}</foreignObject></svg>`;
    const image = new win.Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("HTML-Aufnahme wird von diesem Browser blockiert."));
      image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
    const output = win.document.createElement("canvas"),
      scale = Math.min(1, 1280 / Math.max(w, h));
    output.width = Math.round(w * scale);
    output.height = Math.round(h * scale);
    const ctx = output.getContext("2d");
    if (!ctx) throw new Error("Aufnahmekontext fehlt.");
    ctx.drawImage(image, 0, 0, output.width, output.height);
    try {
      return { image: output.toDataURL("image/png"), w, h };
    } catch {
      if (canvases.length === 1 && win.document.body.children.length === 1)
        return {
          image: canvases[0].toDataURL("image/png"),
          w: canvases[0].width,
          h: canvases[0].height,
        };
      throw new Error("HTML-Aufnahme blockiert: externe Ressourcen benötigen CORS.");
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    runtime.dispose();
    inputs.dispose();
    off.splice(0).forEach((f) => f());
  }
  listen("message", ((event: MessageEvent) => {
    const data = event.data;
    if (
      !boot ||
      event.source !== win.parent ||
      data?.channel !== channel ||
      data.session !== boot.session ||
      data.revision !== boot.revision ||
      typeof data.request !== "string"
    )
      return;
    const op = data.op as CanvasOperation;
    if (!["ready", "shot", "keys", "keys-up", "pause", "stop", "dispose"].includes(op)) return;
    void (async () => {
      try {
        let extra = {};
        if (op === "ready") await ready;
        else if (op === "shot") extra = await snapshot();
        else if (op === "keys" || op === "keys-up") {
          if (
            !Array.isArray(data.keys) ||
            data.keys.length > 24 ||
            !data.keys.every((k: unknown) => typeof k === "string" && k.length <= 64)
          )
            throw new Error("Ungültige Tasteneingabe.");
          if (op === "keys" && (failure || stopped || !loaded))
            throw new Error("Programm ist nicht für Eingaben bereit.");
          inputs.keys(data.keys, op === "keys");
        } else if (op === "pause") runtime.pause(data.paused !== false);
        else if (op === "stop") {
          stopped = true;
          runtime.stop();
          inputs.reset();
        } else dispose();
        send({ request: data.request, op, ...status(), ...extra });
      } catch (error) {
        send({
          request: data.request,
          op,
          ...status(),
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }) as EventListener);
  return { dispose, ready, status };
}
