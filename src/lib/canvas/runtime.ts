import type { CanvasInput, CanvasControls } from "./input";

export type CanvasOptions = {
  canvas?: HTMLCanvasElement | string;
  parent?: string;
  width?: number;
  height?: number;
  w?: number;
  h?: number;
  pixel?: boolean;
  alpha?: boolean;
  gl?: boolean;
  smooth?: boolean;
  fit?: "contain" | "cover" | "fill" | "none";
  background?: string;
  bg?: string;
  font?: string;
  scene?: string;
  fixedStep?: number;
  maxDelta?: number;
  update?: (this: CanvasGame, dt: number) => void;
  draw?: (this: CanvasGame) => void;
  onInput?: (this: CanvasGame) => void;
  onContextRestored?: (this: CanvasGame) => void;
};
export type CanvasGame = ReturnType<ReturnType<typeof installCanvasRuntime>["create"]>;

/** All runtime dependencies are explicit arguments: safe to serialize in a minified build. */
export function installCanvasRuntime(win: Window & typeof globalThis, inputs: CanvasInput) {
  const games = new Set<ReturnType<typeof create>>();
  const attached = new Map<HTMLCanvasElement, CanvasControls>();
  const images = new Map<string, Promise<HTMLImageElement>>();
  const pending = new Set<Promise<unknown>>();
  const cancelImages = new Set<() => void>();
  let audioContext: AudioContext | null = null;
  let disposed = false;
  const changed = () => win.dispatchEvent(new win.Event("anvil-runtime-state"));
  const report = (error: unknown) =>
    win.dispatchEvent(
      new win.CustomEvent("anvil-runtime-error", {
        detail: error instanceof Error ? error.message : String(error),
      }),
    );
  const positive = (n: number, name: string) => {
    if (!Number.isFinite(n) || n <= 0)
      throw new RangeError(name + " muss größer als 0 und endlich sein.");
    return n;
  };
  function audio() {
    const Constructor =
      win.AudioContext ||
      (win as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor || disposed) return null;
    audioContext ||= new Constructor();
    if (audioContext.state === "suspended") void audioContext.resume().catch(() => undefined);
    return audioContext;
  }
  function beep(freq = 440, ms = 80, type: OscillatorType = "sine") {
    const c = audio();
    if (!c) return;
    positive(freq, "Frequenz");
    positive(ms, "Dauer");
    const oscillator = c.createOscillator(),
      gain = c.createGain();
    oscillator.type = type;
    oscillator.frequency.value = freq;
    gain.gain.setValueAtTime(0.06, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + ms / 1000);
    oscillator.connect(gain);
    gain.connect(c.destination);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start();
    oscillator.stop(c.currentTime + ms / 1000);
  }
  function findCanvas(el?: string | HTMLCanvasElement) {
    if (el instanceof win.HTMLCanvasElement) return el;
    const found = el
      ? win.document.getElementById(el) || win.document.querySelector(el)
      : win.document.querySelector("canvas");
    if (found && !(found instanceof win.HTMLCanvasElement))
      throw new Error("Das Ziel ist kein Canvas.");
    return found as HTMLCanvasElement | null;
  }
  function create(opts: CanvasOptions = {}) {
    if (disposed) throw new Error("Canvas-Laufzeit wurde beendet.");
    let w = positive(opts.width ?? opts.w ?? 640, "Breite"),
      h = positive(opts.height ?? opts.h ?? 360, "Höhe");
    let canvas = findCanvas(opts.canvas);
    let owned = false;
    if (!canvas) {
      if (opts.canvas) throw new Error("Canvas nicht gefunden: " + opts.canvas);
      const parent = opts.parent ? win.document.querySelector(opts.parent) : win.document.body;
      if (!parent)
        throw new Error(
          "Canvas erst nach dem Laden des HTML-Dokuments erstellen (defer oder DOMContentLoaded).",
        );
      canvas = win.document.createElement("canvas");
      canvas.id = "c";
      parent.appendChild(canvas);
      owned = true;
    }
    const c = canvas as HTMLCanvasElement & { _cssW?: number; _cssH?: number };
    for (const previous of games) if (previous.canvas === c) previous.dispose(false);
    attached.get(c)?.dispose();
    attached.delete(c);
    const fit = opts.fit ?? "contain";
    let dpr = opts.pixel ? 1 : Math.min(2, win.devicePixelRatio || 1);
    function bitmap() {
      const bw = Math.round(w * dpr),
        bh = Math.round(h * dpr);
      if (bw > 16384 || bh > 16384 || bw * bh > 32_000_000)
        throw new RangeError("Canvas zu groß (maximal 32 Millionen Pixel).");
      c.width = bw;
      c.height = bh;
    }
    bitmap();
    const gl = opts.gl
      ? c.getContext("webgl2", { alpha: opts.alpha !== false, preserveDrawingBuffer: true }) ||
        c.getContext("webgl", { alpha: opts.alpha !== false, preserveDrawingBuffer: true })
      : null;
    const ctx = opts.gl ? null : c.getContext("2d", { alpha: opts.alpha !== false });
    if (opts.gl ? !gl : !ctx)
      throw new Error(
        opts.gl
          ? "WebGL konnte auf diesem Canvas nicht gestartet werden."
          : "Canvas2D konnte nicht gestartet werden. Der Canvas verwendet möglicherweise bereits WebGL.",
      );
    function context() {
      if (!ctx)
        throw new Error(
          "Diese Zeichenfunktion benötigt Canvas2D; bei gl:true den WebGL-Kontext verwenden.",
        );
      return ctx;
    }
    function configure() {
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = opts.smooth !== false && !opts.pixel;
      }
      if (gl) gl.viewport(0, 0, c.width, c.height);
    }
    function fitCanvas() {
      c._cssW = w;
      c._cssH = h;
      const parent = c.parentElement || win.document.body;
      // The body may derive its height from this canvas. Use the viewport at the
      // document root so resizing cannot feed the child's height back into itself.
      const root = parent === win.document.body || parent === win.document.documentElement;
      const style = win.getComputedStyle(parent);
      const pw = Math.max(
        1,
        (parent.clientWidth || win.innerWidth) -
          parseFloat(style.paddingLeft || "0") -
          parseFloat(style.paddingRight || "0"),
      );
      const ph = Math.max(
        1,
        (root
          ? win.innerHeight -
            Math.max(0, parent.getBoundingClientRect().top) -
            parseFloat(style.marginBottom || "0")
          : parent.clientHeight || h) -
          parseFloat(style.paddingTop || "0") -
          parseFloat(style.paddingBottom || "0"),
      );
      c.style.imageRendering = opts.pixel ? "pixelated" : "auto";
      if (fit === "cover") c.style.maxWidth = "none";
      if (fit === "fill") {
        c.style.width = "100%";
        c.style.height = "100%";
        return;
      }
      const scale =
        fit === "none" ? 1 : fit === "cover" ? Math.max(pw / w, ph / h) : Math.min(pw / w, ph / h);
      const cssWidth = Math.max(1, Math.round(w * scale)) + "px",
        cssHeight = Math.max(1, Math.round(h * scale)) + "px";
      if (c.style.width !== cssWidth) c.style.width = cssWidth;
      if (c.style.height !== cssHeight) c.style.height = cssHeight;
    }
    configure();
    fitCanvas();
    let controls = inputs.bind(c);
    let raf = 0,
      resizeRaf = 0,
      running = false,
      dead = false,
      last = 0,
      accumulator = 0;
    let observer: ResizeObserver | null = null;
    const bg = opts.background ?? opts.bg ?? "#0a0a0b";
    const maxDelta = positive(opts.maxDelta ?? 0.05, "maxDelta");
    const fixedStep = opts.fixedStep == null ? 0 : positive(opts.fixedStep, "fixedStep");
    function font(size?: number) {
      const value = opts.font || "13px ui-sans-serif, system-ui, sans-serif";
      if (size != null) positive(size, "Schriftgröße");
      return /\b\d+(?:\.\d+)?px\b/.test(value)
        ? size == null
          ? value
          : value.replace(/\b\d+(?:\.\d+)?px\b/, size + "px")
        : (size ?? 13) + "px " + value;
    }
    const game = {
      canvas: c,
      ctx,
      gl,
      width: w,
      height: h,
      dpr,
      dt: 0,
      time: 0,
      fps: 0,
      paused: false,
      timeScale: 1,
      state: "created" as "created" | "running" | "paused" | "stopped" | "failed" | "disposed",
      error: "",
      scene: opts.scene || "main",
      cam: { x: w / 2, y: h / 2, z: 1, r: 0 },
      get key() {
        return controls.key;
      },
      get mouse() {
        return controls.mouse;
      },
      get pad() {
        return controls.pad;
      },
      get input() {
        return controls.input;
      },
      update: opts.update as CanvasOptions["update"],
      draw: opts.draw as CanvasOptions["draw"],
      onInput: opts.onInput as CanvasOptions["onInput"],
      beep,
      clamp: (n: number, a: number, b: number) => Math.max(a, Math.min(b, n)),
      lerp: (a: number, b: number, t: number) => a + (b - a) * t,
      ease(t: number) {
        t = Math.max(0, Math.min(1, t));
        return t * t * (3 - 2 * t);
      },
      dist: (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay),
      hit: (
        ax: number,
        ay: number,
        aw: number,
        ah: number,
        bx: number,
        by: number,
        bw: number,
        bh: number,
      ) => ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by,
      pointIn: (px: number, py: number, x: number, y: number, rw: number, rh: number) =>
        px >= x && py >= y && px <= x + rw && py <= y + rh,
      rand: (a: number, b?: number) =>
        b == null ? Math.random() * a : a + Math.random() * (b - a),
      color: (hue = 0, s = 70, l = 50, a = 1) => `hsla(${hue},${s}%,${l}%,${a})`,
      world() {
        const x = context();
        x.save();
        x.translate(w / 2, h / 2);
        x.rotate(game.cam.r);
        x.scale(game.cam.z || 1, game.cam.z || 1);
        x.translate(-game.cam.x, -game.cam.y);
      },
      hud() {
        context().restore();
      },
      toWorld(x = controls.mouse.x, y = controls.mouse.y) {
        const dx = x - w / 2,
          dy = y - h / 2,
          cos = Math.cos(-game.cam.r),
          sin = Math.sin(-game.cam.r),
          z = game.cam.z || 1;
        return {
          x: game.cam.x + (dx * cos - dy * sin) / z,
          y: game.cam.y + (dx * sin + dy * cos) / z,
        };
      },
      clear(color = bg) {
        const x = context();
        x.save();
        try {
          x.setTransform(dpr, 0, 0, dpr, 0, 0);
          x.globalAlpha = 1;
          x.globalCompositeOperation = "source-over";
          x.clearRect(0, 0, w, h);
          x.fillStyle = color;
          x.fillRect(0, 0, w, h);
        } finally {
          x.restore();
        }
      },
      rect(x: number, y: number, rw: number, rh: number, color: string) {
        const c = context();
        c.fillStyle = color;
        c.fillRect(x, y, rw, rh);
      },
      round(x: number, y: number, rw: number, rh: number, radius = 8, color = "#ececec") {
        const c = context();
        c.fillStyle = color;
        c.beginPath();
        c.roundRect(
          x,
          y,
          rw,
          rh,
          Math.max(0, Math.min(radius, Math.abs(rw) / 2, Math.abs(rh) / 2)),
        );
        c.fill();
      },
      stroke(x: number, y: number, rw: number, rh: number, color: string, lw = 1) {
        const c = context();
        c.strokeStyle = color;
        c.lineWidth = lw;
        c.strokeRect(x, y, rw, rh);
      },
      circle(x: number, y: number, r: number, color: string) {
        const c = context();
        c.fillStyle = color;
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
      },
      ring(x: number, y: number, r: number, color: string, lw = 2) {
        const c = context();
        c.strokeStyle = color;
        c.lineWidth = lw;
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.stroke();
      },
      line(x1: number, y1: number, x2: number, y2: number, color = "#ececec", lw = 1) {
        const c = context();
        c.strokeStyle = color;
        c.lineWidth = lw;
        c.beginPath();
        c.moveTo(x1, y1);
        c.lineTo(x2, y2);
        c.stroke();
      },
      poly(points: number[][], color: string, fill = true) {
        if (!points.length) return;
        const c = context();
        c.beginPath();
        c.moveTo(points[0][0], points[0][1]);
        points.slice(1).forEach((p) => c.lineTo(p[0], p[1]));
        c.closePath();
        if (fill) {
          c.fillStyle = color;
          c.fill();
        } else {
          c.strokeStyle = color;
          c.stroke();
        }
      },
      grid(step = 32, color = "rgba(255,255,255,.06)") {
        positive(step, "Rasterabstand");
        if ((w + h) / step > 10000) throw new RangeError("Raster zu fein (maximal 10000 Linien).");
        const c = context();
        c.strokeStyle = color;
        c.lineWidth = 1;
        c.beginPath();
        for (let x = 0; x <= w; x += step) {
          c.moveTo(x, 0);
          c.lineTo(x, h);
        }
        for (let y = 0; y <= h; y += step) {
          c.moveTo(0, y);
          c.lineTo(w, y);
        }
        c.stroke();
      },
      text(
        text: string,
        x: number,
        y: number,
        color = "#ececec",
        size?: number,
        align: CanvasTextAlign = "start",
      ) {
        const c = context();
        c.save();
        try {
          c.fillStyle = color;
          c.font = font(size);
          c.textAlign = align;
          c.textBaseline = "top";
          c.fillText(String(text), x, y);
        } finally {
          c.restore();
        }
      },
      measure(text: string, size?: number) {
        const c = context();
        c.save();
        try {
          c.font = font(size);
          return c.measureText(String(text)).width;
        } finally {
          c.restore();
        }
      },
      image(img: CanvasImageSource, x: number, y: number, rw?: number, rh?: number) {
        if (!img) return;
        const c = context();
        if (rw == null) c.drawImage(img, x, y);
        else c.drawImage(img, x, y, rw, rh ?? rw);
      },
      sprite(
        img: CanvasImageSource,
        sx: number,
        sy: number,
        sw: number,
        sh: number,
        dx: number,
        dy: number,
        dw = sw,
        dh = sh,
      ) {
        if (img) context().drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
      },
      alpha(a: number, fn?: () => void) {
        const c = context(),
          prev = c.globalAlpha;
        c.globalAlpha = a;
        if (fn) {
          try {
            fn();
          } finally {
            c.globalAlpha = prev;
          }
        }
      },
      png() {
        try {
          return c.toDataURL("image/png");
        } catch {
          throw new Error(
            "Canvas-Aufnahme blockiert: Ein externes Bild erlaubt keinen CORS-Zugriff.",
          );
        }
      },
      resize(nw: number, nh: number) {
        positive(nw, "Breite");
        positive(nh, "Höhe");
        if (
          Math.round(nw * dpr) * Math.round(nh * dpr) > 32_000_000 ||
          Math.max(nw, nh) * dpr > 16384
        )
          throw new RangeError("Canvas zu groß.");
        const properties = [
          "fillStyle",
          "strokeStyle",
          "font",
          "textAlign",
          "textBaseline",
          "lineWidth",
          "lineCap",
          "lineJoin",
          "globalAlpha",
          "globalCompositeOperation",
        ] as const;
        const saved = ctx ? Object.fromEntries(properties.map((k) => [k, ctx[k]])) : {};
        w = nw;
        h = nh;
        game.width = w;
        game.height = h;
        bitmap();
        configure();
        if (ctx) Object.assign(ctx, saved);
        fitCanvas();
      },
      pause(on = true) {
        game.paused = on;
        controls.reset();
        if (running) game.state = on ? "paused" : "running";
        changed();
      },
      stop() {
        running = false;
        win.cancelAnimationFrame(raf);
        raf = 0;
        win.cancelAnimationFrame(resizeRaf);
        resizeRaf = 0;
        win.removeEventListener("resize", scheduleFit);
        controls.dispose();
        observer?.disconnect();
        observer = null;
        if (game.state !== "failed" && !dead) game.state = "stopped";
        changed();
      },
      start() {
        if (dead) throw new Error("Canvas wurde freigegeben. Eine neue Instanz erstellen.");
        if (running) return game;
        if (game.state === "stopped" || game.state === "failed") controls = inputs.bind(c);
        game.error = "";
        running = true;
        last = win.performance.now();
        accumulator = 0;
        game.state = game.paused ? "paused" : "running";
        observe();
        try {
          game.draw?.call(game);
        } catch (error) {
          fail(error);
          return game;
        }
        if (running) {
          raf = win.requestAnimationFrame(tick);
          c.focus({ preventScroll: true });
          controls.focus();
        }
        changed();
        return game;
      },
      dispose(removeCanvas = owned) {
        if (dead) return;
        game.stop();
        dead = true;
        game.state = "disposed";
        c.removeEventListener("webglcontextlost", lost);
        c.removeEventListener("webglcontextrestored", restored);
        games.delete(game);
        if (removeCanvas) c.remove();
        changed();
      },
    };
    function fail(error: unknown) {
      game.error = error instanceof Error ? error.message : String(error);
      game.state = "failed";
      game.stop();
      report(error);
    }
    function scheduleFit() {
      if (resizeRaf || dead) return;
      resizeRaf = win.requestAnimationFrame(() => {
        resizeRaf = 0;
        try {
          fitCanvas();
        } catch (error) {
          fail(error);
        }
      });
    }
    function observe() {
      if (observer || fit === "none" || !win.ResizeObserver) return;
      // ResizeObserver delivers before paint. Mutate layout in the next frame,
      // outside the observer delivery, and coalesce container/viewport changes.
      observer = new win.ResizeObserver(scheduleFit);
      observer.observe(c.parentElement || win.document.body);
      win.addEventListener("resize", scheduleFit);
    }
    function tick(t: number) {
      if (!running) return;
      const raw = Math.max(0, (t - last) / 1000);
      last = t;
      let consumed = !fixedStep || game.paused || win.document.hidden;
      game.fps = raw > 0 ? Math.round(1 / raw) : 0;
      try {
        const scale = game.timeScale;
        if (!Number.isFinite(scale) || scale < 0)
          throw new RangeError("timeScale muss endlich und mindestens 0 sein.");
        const nextDpr = opts.pixel ? 1 : Math.min(2, win.devicePixelRatio || 1);
        if (nextDpr !== dpr) {
          dpr = nextDpr;
          game.dpr = dpr;
          game.resize(w, h);
        }
        controls.update(t);
        const point = game.toWorld();
        controls.mouse.wx = point.x;
        controls.mouse.wy = point.y;
        game.onInput?.call(game);
        game.dt = game.paused || win.document.hidden ? 0 : Math.min(maxDelta, raw) * scale;
        if (!game.paused && !win.document.hidden) {
          if (fixedStep) {
            accumulator = Math.min(accumulator + game.dt, fixedStep * 8);
            let steps = 0;
            while (running && !game.paused && accumulator >= fixedStep && steps++ < 8) {
              game.time += fixedStep;
              game.update?.call(game, fixedStep);
              accumulator -= fixedStep;
              controls.endFrame();
              consumed = true;
            }
          } else {
            game.time += game.dt;
            game.update?.call(game, game.dt);
          }
          if (running) game.draw?.call(game);
        }
      } catch (error) {
        fail(error);
      } finally {
        if (consumed) controls.endFrame();
      }
      if (running) raf = win.requestAnimationFrame(tick);
    }
    function lost(event: Event) {
      event.preventDefault();
      fail(new Error("WebGL-Kontext verloren. Nach Wiederherstellung Run neu starten."));
    }
    function restored() {
      try {
        configure();
        opts.onContextRestored?.call(game);
      } catch (error) {
        fail(error);
      }
    }
    c.addEventListener("webglcontextlost", lost);
    c.addEventListener("webglcontextrestored", restored);
    observe();
    games.add(game);
    return game;
  }
  function loadImage(
    src: string,
    options?: { signal?: AbortSignal; crossOrigin?: "" | "anonymous" | "use-credentials" },
  ) {
    if (disposed)
      return Promise.reject(new win.DOMException("Canvas-Laufzeit wurde beendet.", "AbortError"));
    src =
      (win as unknown as { __ANVIL_ASSET__?: (path: string) => string }).__ANVIL_ASSET__?.(src) ??
      src;
    const key = (options?.crossOrigin ?? "anonymous") + ":" + src;
    if (!options?.signal && images.has(key)) return images.get(key)!;
    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new win.Image();
      const signal = options?.signal;
      let finished = false;
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        cancelImages.delete(abort);
        signal?.removeEventListener("abort", abort);
        image.onload = image.onerror = null;
        if (error) reject(error);
        else resolve(image);
      };
      const abort = () => {
        finish(new win.DOMException("Bildladen abgebrochen", "AbortError"));
        image.src = "";
      };
      cancelImages.add(abort);
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      image.crossOrigin = options?.crossOrigin ?? "anonymous";
      image.onload = () => {
        void image.decode().then(
          () => finish(),
          () => finish(new Error("Bild konnte nicht dekodiert werden: " + src)),
        );
      };
      image.onerror = () =>
        finish(new Error("Bild konnte nicht geladen werden (Pfad/CORS prüfen): " + src));
      image.src = src;
    });
    pending.add(promise);
    if (!options?.signal) images.set(key, promise);
    void promise.then(
      () => pending.delete(promise),
      (error) => {
        pending.delete(promise);
        images.delete(key);
        if (error?.name !== "AbortError") report(error);
      },
    );
    return promise;
  }
  const api = {
    _ok: true,
    _audio: audio,
    map: inputs.map,
    beep,
    create,
    loadImage,
    attach(el: string | HTMLCanvasElement) {
      const c = findCanvas(el);
      if (!c) throw new Error("Canvas nicht gefunden.");
      const game = [...games].find((g) => g.canvas === c);
      if (game)
        return {
          canvas: c,
          get key() {
            return game.key;
          },
          get mouse() {
            return game.mouse;
          },
          get pad() {
            return game.pad;
          },
          get input() {
            return game.input;
          },
          update() {},
          endFrame() {},
          dispose() {},
        };
      const previous = attached.get(c);
      if (previous) return previous;
      const handle = inputs.bind(c, true);
      const release = handle.dispose;
      handle.dispose = () => {
        release();
        attached.delete(c);
      };
      attached.set(c, handle);
      return handle;
    },
    run(opts: CanvasOptions = {}) {
      return create(opts).start();
    },
    async ready() {
      while (pending.size) await Promise.all([...pending]);
    },
    status() {
      const failed = [...games].find((g) => g.state === "failed");
      return {
        state: failed
          ? "failed"
          : [...games].some((g) => g.state === "running")
            ? "running"
            : [...games].some((g) => g.state === "paused")
              ? "paused"
              : games.size
                ? "stopped"
                : "ready",
        error: failed?.error || "",
      };
    },
    pause(on = true) {
      games.forEach((g) => g.pause(on));
    },
    stop() {
      games.forEach((g) => g.stop());
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      [...games].forEach((g) => g.dispose(false));
      cancelImages.forEach((cancel) => cancel());
      inputs.dispose();
      attached.clear();
      images.clear();
      void audioContext?.close().catch(() => undefined);
      audioContext = null;
      win.removeEventListener("pointerdown", unlock);
    },
  };
  function unlock() {
    if (audioContext?.state === "suspended") void audioContext.resume().catch(() => undefined);
  }
  win.addEventListener("pointerdown", unlock, { passive: true });
  return api;
}
export type CanvasRuntime = ReturnType<typeof installCanvasRuntime>;
