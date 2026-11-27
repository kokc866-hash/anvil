import type { CanvasRuntime } from "./runtime";
import type { CanvasInput } from "./input";
import type { PreviewAutomation } from './automation';
import type { CanvasBoot, CanvasOperation, CanvasReply, CanvasState } from "./protocol";

/** Guest side. Never trusts a frame name, wildcard sender, or an old run's response. */
export function installCanvasBridge(
  win: Window & typeof globalThis,
  inputs: CanvasInput,
  runtime: CanvasRuntime,
  automation?: PreviewAutomation,
) {
  const boot = (win as unknown as { __ANVIL_SESSION__?: CanvasBoot }).__ANVIL_SESSION__;
  const channel = "anvil-canvas-v2";
  const logs: string[] = [];
  // load/DOMContentLoaded do not wait for top-level await in project modules.
  // Track only the initial async work; never change timer delays or fetch results.
  const nativeTimeout = win.setTimeout.bind(win);
  const nativeClearTimeout = win.clearTimeout.bind(win);
  const pendingTimers = new Set<number>();
  let pendingFetches = 0, trackingInitialWork = true, visualRevision = 0, timerDepth = 0, repeatingTimer = false;
  const initialTimeout = win.setTimeout;
  const initialClearTimeout = win.clearTimeout;
  const initialClearInterval = win.clearInterval;
  const initialFetch = win.fetch;
  const trackedTimeout: typeof win.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (!trackingInitialWork || typeof handler !== "function") return nativeTimeout(handler, delay, ...args);
    // A future autosave/notification is not an initial render. Observe short
    // startup work and at most two generations of a self-rescheduling loop.
    const depth = timerDepth + 1;
    if (Number(delay || 0) > 6000 || depth > 2) {
      if (depth > 2) repeatingTimer = true;
      return nativeTimeout(handler, delay, ...args);
    }
    let timer = 0;
    timer = nativeTimeout(() => {
      pendingTimers.delete(timer);
      const previous = timerDepth;
      timerDepth = depth;
      try { handler.apply(win, args); } finally { timerDepth = previous; }
    }, delay);
    pendingTimers.add(timer);
    return timer;
  }) as typeof win.setTimeout;
  const trackedClearTimeout: typeof win.clearTimeout = ((timer?: number) => {
    if (typeof timer === "number") pendingTimers.delete(timer);
    nativeClearTimeout(timer);
  }) as typeof win.clearTimeout;
  const trackedFetch: typeof win.fetch = (...args) => {
    const promise = initialFetch.apply(win, args);
    if (trackingInitialWork) {
      pendingFetches++;
      void promise.then(() => { pendingFetches--; }, () => { pendingFetches--; });
    }
    return promise;
  };
  win.setTimeout = trackedTimeout;
  win.clearTimeout = trackedClearTimeout;
  win.clearInterval = trackedClearTimeout;
  win.fetch = trackedFetch;
  function stopInitialTracking() {
    trackingInitialWork = false;
    pendingTimers.clear();
    if (win.setTimeout === trackedTimeout) win.setTimeout = initialTimeout;
    if (win.clearTimeout === trackedClearTimeout) win.clearTimeout = initialClearTimeout;
    if (win.clearInterval === trackedClearTimeout) win.clearInterval = initialClearInterval;
    if (win.fetch === trackedFetch) win.fetch = initialFetch;
  }
  const mutations = new win.MutationObserver(() => { visualRevision++; });
  mutations.observe(win.document, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ["class", "style", "src", "srcset", "href", "width", "height", "hidden", "value", "aria-busy"] });
  const pause = (ms: number) => new Promise<void>(resolve => nativeTimeout(resolve, ms));
  const captureState = () => ({ revision: visualRevision, width: win.innerWidth, height: win.innerHeight });
  async function settleFrame() {
    const start = Date.now();
    let previous = "", stableSince = start;
    while (Date.now() - start < 6000) {
      if (disposed || stopped) throw new Error("Vorschau wurde während der Aufnahme beendet.");
      if (failure) throw new Error(failure);
      const images = Array.from(win.document.images);
      if (images.some(image => image.complete && image.src && !image.naturalWidth)) throw new Error("Ein Vorschaubild konnte nicht geladen werden.");
      const pending = trackingInitialWork && (pendingTimers.size > 0 || pendingFetches > 0)
        || images.some(image => !image.complete) || win.document.fonts?.status === "loading"
        || Boolean(win.document.querySelector('[aria-busy="true"]'));
      const current = JSON.stringify(captureState());
      if (current !== previous || pending) { previous = current; stableSince = Date.now(); }
      if (!pending && Date.now() - stableSince >= 120) {
        await new Promise<void>(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve())));
        if (JSON.stringify(captureState()) === current)
          return { state: trackingInitialWork && repeatingTimer ? "live" as const : "settled" as const, waitedMs: Date.now() - start, ...captureState() };
      }
      // Continuous DOM animation is a valid live frame, never an endless wait.
      if (!pending && Date.now() - start >= 1800)
        return { state: "live" as const, waitedMs: Date.now() - start, ...captureState() };
      await pause(30);
    }
    throw new Error("Die Vorschau wird noch vorbereitet. Keine verlässliche Aufnahme: ausstehende Initialisierung oder Ressourcen.");
  }
  let outputSize: { width: number; height: number } | undefined;
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
      outputSize,
      observation: loaded && !disposed ? automation?.describe() : undefined,
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
      await settleFrame();
      stopInitialTracking();
      loaded = true;
      // Measure once before the host resizes. Re-measuring a responsive page
      // after every resize would feed its viewport back into the window size.
      const body = win.document.body;
      const elements = Array.from(body.querySelectorAll<HTMLElement>("*"))
        .filter(el => !el.children.length && !["SCRIPT", "STYLE", "LINK"].includes(el.tagName)).slice(0, 4096);
      const boxes = elements.map(el => ({ el, rect: el.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0);
      if (boxes.length) {
        let width = Math.max(...boxes.map(b => b.rect.right)) - Math.min(...boxes.map(b => b.rect.left));
        let height = Math.max(...boxes.map(b => b.rect.bottom)) - Math.min(...boxes.map(b => b.rect.top));
        const media = boxes.filter(b => ["CANVAS", "IMG", "VIDEO"].includes(b.el.tagName));
        if (media.length === 1) {
          const { el, rect } = media[0];
          const canvas = el as HTMLCanvasElement & { _cssW?: number; _cssH?: number };
          const image = el as HTMLImageElement;
          // Anvil's logical dimensions are independent of devicePixelRatio.
          // Other media keep their rendered CSS dimensions when explicitly sized.
          const w = canvas._cssW || (!el.style.width && el.tagName === "CANVAS" ? canvas.width : 0) || rect.width;
          const h = canvas._cssH || (!el.style.height && el.tagName === "CANVAS" ? canvas.height : 0) || rect.height;
          width += w - rect.width;
          height += h - rect.height;
          if (el.tagName === "IMG" && !el.getAttribute("style") && rect.width < image.naturalWidth) {
            width += image.naturalWidth - rect.width;
            height += image.naturalHeight - rect.height;
          }
        }
        const style = win.getComputedStyle(body);
        const px = (s: string) => Math.max(0, parseFloat(s) || 0);
        width += px(style.marginLeft) + px(style.marginRight) + px(style.paddingLeft) + px(style.paddingRight);
        height += px(style.marginTop) + px(style.marginBottom) + px(style.paddingTop) + px(style.paddingBottom);
        if (Number.isFinite(width) && Number.isFinite(height)) outputSize = { width: Math.ceil(width), height: Math.ceil(height) };
      }
      send({ op: "state", ...status() });
    })
    .catch((error) => {
      stopInitialTracking();
      loaded = true;
      log("error", error instanceof Error ? error.message : String(error));
    });
  async function snapshot(attempt = 0): Promise<{ image: string; w: number; h: number; readiness?: Awaited<ReturnType<typeof settleFrame>> }> {
    await ready;
    await runtime.ready();
    const readiness = await settleFrame();
    const before = JSON.stringify(captureState());
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
    // The browser paints a paper behind transparent HTML. Preserve that opaque
    // backdrop in the PNG too, so black text cannot disappear in a dark viewer.
    const rootStyle = win.getComputedStyle(win.document.documentElement);
    const rootColor = rootStyle.backgroundColor;
    const transparent = (color: string) => color === "transparent" || /rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(color);
    const paper = transparent(rootColor) && rootStyle.backgroundImage === "none"
      ? win.getComputedStyle(win.document.body).backgroundColor : rootColor;
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, 1, 1);
    const opaque = ctx.getImageData(0, 0, 1, 1).data[3] === 255;
    ctx.clearRect(0, 0, output.width, output.height);
    ctx.fillStyle = opaque ? paper : "#ffffff";
    ctx.fillRect(0, 0, output.width, output.height);
    ctx.drawImage(image, 0, 0, output.width, output.height);
    if (readiness.state !== "live" && before !== JSON.stringify(captureState())) {
      if (attempt < 2) return snapshot(attempt + 1);
      throw new Error("Vorschau wurde während der Aufnahme verändert. Aufnahme erneut anfordern.");
    }
    try {
      return { image: output.toDataURL("image/png"), w, h, readiness };
    } catch {
      if (canvases.length === 1 && win.document.body.children.length === 1)
        return {
          image: canvases[0].toDataURL("image/png"),
          w: canvases[0].width,
          h: canvases[0].height,
          readiness,
        };
      throw new Error("HTML-Aufnahme blockiert: externe Ressourcen benötigen CORS.");
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    stopInitialTracking();
    mutations.disconnect();
    runtime.dispose();
    inputs.dispose();
    automation?.reset();
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
    if (!["ready", "capture-ready", "shot", "keys", "keys-up", "input", "input-up", "target", "assert", "pause", "stop", "dispose"].includes(op)) return;
    void (async () => {
      try {
        let extra = {};
        if (op === "ready") await ready;
        else if (op === "capture-ready") { await ready; extra = { readiness: await settleFrame() }; }
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
        } else if (op === 'input' || op === 'input-up' || op === 'target' || op === 'assert') {
          if (!automation) throw new Error('Diese Vorschau bietet keine erweiterte Eingabesteuerung.');
          if (op !== 'input-up' && (failure || stopped || !loaded)) throw new Error('Programm ist nicht für Eingaben bereit.');
          if (op === 'assert') automation.assert(data.action);
          else if (op === 'target') extra = {point:automation.target(data.target,data.scroll!==false)};
          else automation.event(data.event);
        } else if (op === "pause") runtime.pause(data.paused !== false);
        else if (op === "stop") {
          stopped = true;
          runtime.stop();
          inputs.reset();
          automation?.reset();
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
  const preview = Object.freeze({ ready: async () => {
    await ready;
    if (!status().ok) return status();
    try { return { ...status(), readiness: await settleFrame() }; }
    catch (error) { if (!status().ok) return status(); throw error; }
  }, state: captureState, input: automation });
  Object.defineProperty(win, "__ANVIL_PREVIEW__", { value: preview, configurable: false, writable: false });
  return { dispose, ready, status };
}
