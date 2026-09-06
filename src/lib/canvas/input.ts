import type { InputMap } from "../input-map";

/** Self-contained: serialized into the sandbox together with the renderer. */
export function installCanvasInput(win: Window & typeof globalThis, initialMap: InputMap) {
  let map = initialMap;
  let active: HTMLCanvasElement | null = null;
  const handles = new Set<ReturnType<typeof bind>>();
  const actions = ["left", "right", "up", "down", "ok", "fire", "start"] as const;
  function bind(canvas: HTMLCanvasElement, automatic = false) {
    const keys = new Set<string>(),
      pressed = new Set<string>(),
      released = new Set<string>();
    const mouse = {
      x: 0,
      y: 0,
      wx: 0,
      wy: 0,
      down: false,
      clicked: false,
      buttons: 0,
      left: false,
      right: false,
      middle: false,
      pressed: false,
      released: false,
      wheel: 0,
      dx: 0,
      dy: 0,
    };
    const pad = {
      connected: false,
      ax: 0,
      ay: 0,
      ax2: 0,
      ay2: 0,
      left: false,
      right: false,
      up: false,
      down: false,
      ok: false,
      fire: false,
      start: false,
      a: false,
      b: false,
      x: false,
      y: false,
      l: false,
      r: false,
      aPressed: false,
      bPressed: false,
      xPressed: false,
      yPressed: false,
      startPressed: false,
      okPressed: false,
      firePressed: false,
      action: {} as Record<string, boolean>,
      actionPressed: {} as Record<string, boolean>,
    };
    const held: Record<string, boolean> = {};
    const off: (() => void)[] = [];
    let disposed = false,
      raf = 0,
      clearTimer = 0;
    let lastPadTime = -1;
    function listen(
      target: EventTarget,
      name: string,
      fn: (event: never) => void,
      opts?: AddEventListenerOptions,
    ) {
      target.addEventListener(name, fn as EventListener, opts);
      off.push(() => target.removeEventListener(name, fn as EventListener, opts));
    }
    function endFrame() {
      pressed.clear();
      released.clear();
      mouse.clicked = mouse.pressed = mouse.released = false;
      mouse.wheel = mouse.dx = mouse.dy = 0;
      for (const name of Object.keys(pad.actionPressed)) {
        pad.actionPressed[name] = false;
        Object.assign(pad, { [name + "Pressed"]: false });
      }
    }
    function reset() {
      keys.clear();
      endFrame();
      mouse.buttons = 0;
      mouse.down = mouse.left = mouse.right = mouse.middle = false;
      for (const name of [...actions, "a", "b", "x", "y", "l", "r"]) edge(name, false);
      endFrame();
      pad.ax = pad.ay = pad.ax2 = pad.ay2 = 0;
    }
    function focus() {
      if (active !== canvas) for (const h of handles) h.reset();
      active = canvas;
    }
    function typing(event: KeyboardEvent) {
      const el = event.target as HTMLElement | null;
      return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
    }
    function onKey(event: KeyboardEvent, down: boolean) {
      if (down && (active !== canvas || typing(event))) return;
      for (const value of [event.key, event.code].filter(Boolean)) {
        if (down) {
          if (!keys.has(value)) pressed.add(value);
          keys.add(value);
        } else if (keys.delete(value)) released.add(value);
      }
      if (
        active === canvas &&
        !typing(event) &&
        (event.key === " " || event.key.startsWith("Arrow") || event.key === "Tab")
      )
        event.preventDefault();
    }
    function point(event: PointerEvent) {
      const box = canvas.getBoundingClientRect();
      const css = canvas as HTMLCanvasElement & { _cssW?: number; _cssH?: number };
      const x = ((event.clientX - box.left) * (css._cssW || canvas.width)) / Math.max(1, box.width);
      const y =
        ((event.clientY - box.top) * (css._cssH || canvas.height)) / Math.max(1, box.height);
      mouse.dx += x - mouse.x;
      mouse.dy += y - mouse.y;
      mouse.x = x;
      mouse.y = y;
    }
    function buttons(value: number) {
      mouse.buttons = value;
      mouse.down = value !== 0;
      mouse.left = !!(value & 1);
      mouse.right = !!(value & 2);
      mouse.middle = !!(value & 4);
    }
    function edge(name: string, on: boolean) {
      const first = (on && !held[name]) || pad.actionPressed[name] || false;
      held[name] = on;
      Object.assign(pad, { [name]: on, [name + "Pressed"]: first });
      pad.action[name] = on;
      pad.actionPressed[name] = first;
    }
    function update(now = win.performance.now()) {
      if (disposed || now === lastPadTime) return;
      lastPadTime = now;
      let gamepad: Gamepad | undefined;
      try {
        if (active === canvas && !win.document.hidden && win.document.hasFocus())
          gamepad = Array.from(win.navigator.getGamepads?.() || []).find((p): p is Gamepad => !!p);
      } catch {
        /* Browser may deny gamepad access. */
      }
      pad.connected = !!gamepad;
      const axis = (index: number) => {
        const n = gamepad?.axes[index] || 0;
        return Math.abs(n) > map.deadzone ? n : 0;
      };
      pad.ax = axis(0);
      pad.ay = axis(1);
      pad.ax2 = axis(2);
      pad.ay2 = axis(3);
      const button = (ids: number[]) => ids.some((i) => gamepad?.buttons[i]?.pressed);
      for (const name of actions) {
        let on = button(map[name].pad);
        if (map.stick)
          on ||=
            name === "left"
              ? pad.ax < 0
              : name === "right"
                ? pad.ax > 0
                : name === "up"
                  ? pad.ay < 0
                  : name === "down"
                    ? pad.ay > 0
                    : false;
        edge(name, on);
      }
      ["a", "b", "x", "y", "l", "r"].forEach((name, i) => edge(name, button([i])));
    }
    const input = {} as Record<(typeof actions)[number], boolean>;
    for (const name of actions)
      Object.defineProperty(input, name, {
        get: () => {
          const once = name === "ok" || name === "fire" || name === "start";
          return (
            map[name].keys.some((k) => (once ? pressed : keys).has(k)) ||
            (once ? pad.actionPressed[name] : pad.action[name]) ||
            false
          );
        },
      });
    canvas.tabIndex = canvas.tabIndex >= 0 ? canvas.tabIndex : 0;
    const oldTouch = canvas.style.touchAction;
    canvas.style.touchAction = "none";
    active ||= canvas;
    listen(canvas, "focus", focus);
    listen(win, "keydown", (e: KeyboardEvent) => onKey(e, true));
    listen(win, "keyup", (e: KeyboardEvent) => onKey(e, false));
    listen(canvas, "pointermove", point);
    listen(canvas, "pointerdown", (e: PointerEvent) => {
      focus();
      point(e);
      buttons(e.buttons);
      mouse.clicked = mouse.pressed = true;
      canvas.focus({ preventScroll: true });
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* Pointer already ended. */
      }
    });
    listen(canvas, "pointerup", (e: PointerEvent) => {
      point(e);
      buttons(e.buttons);
      mouse.released = true;
    });
    listen(canvas, "pointercancel", reset);
    listen(canvas, "lostpointercapture", () => {
      buttons(0);
      mouse.released = true;
    });
    listen(
      canvas,
      "wheel",
      (e: WheelEvent) => {
        mouse.wheel += e.deltaY;
        e.preventDefault();
      },
      { passive: false },
    );
    listen(canvas, "contextmenu", (e: Event) => e.preventDefault());
    listen(win, "blur", reset);
    const handle = {
      canvas,
      mouse,
      pad,
      input,
      key: {
        down: (k: string) => keys.has(k),
        pressed: (k: string) => pressed.has(k),
        released: (k: string) => released.has(k),
      },
      update,
      endFrame,
      reset,
      focus,
      dispose() {
        if (disposed) return;
        disposed = true;
        win.cancelAnimationFrame(raf);
        win.clearTimeout(clearTimer);
        off.forEach((f) => f());
        reset();
        handles.delete(handle);
        canvas.style.touchAction = oldTouch;
        if (active === canvas) active = handles.values().next().value?.canvas || null;
      },
    };
    handles.add(handle);
    if (automatic) {
      const tick = (t: number) => {
        if (disposed) return;
        update(t);
        // End-of-frame task runs after the application's own rAF callbacks.
        win.clearTimeout(clearTimer);
        clearTimer = win.setTimeout(endFrame, 0);
        raf = win.requestAnimationFrame(tick);
      };
      raf = win.requestAnimationFrame(tick);
    }
    return handle;
  }
  return {
    bind,
    map(next?: InputMap) {
      if (next) {
        for (const name of actions)
          if (!Array.isArray(next[name]?.keys) || !Array.isArray(next[name]?.pad))
            throw new Error("Ungültige Eingabebelegung: " + name);
        map = {
          ...next,
          deadzone: Number.isFinite(next.deadzone)
            ? Math.max(0, Math.min(0.95, next.deadzone))
            : 0.28,
        };
        handles.forEach((h) => h.reset());
      }
      return map;
    },
    reset() {
      handles.forEach((h) => h.reset());
    },
    dispose() {
      [...handles].forEach((h) => h.dispose());
    },
    target() {
      return active;
    },
    keys(values: string[], down: boolean) {
      const target = active || win.document.activeElement || win.document.body;
      for (const raw of values) {
        const action = actions.find((a) => a === raw.toLowerCase());
        const value = action ? map[action].keys[0] : raw.toLowerCase() === "space" ? " " : raw;
        if (!value) continue;
        const key = /^Key[A-Z]$/.test(value)
          ? value.slice(3).toLowerCase()
          : /^Digit[0-9]$/.test(value)
            ? value.slice(5)
            : value === "Space"
              ? " "
              : /^(Shift|Control|Alt|Meta)(Left|Right)$/.test(value)
                ? value.replace(/Left|Right/, "")
                : value;
        const code =
          value !== key
            ? value
            : key === " "
              ? "Space"
              : /^[a-z]$/i.test(key)
                ? "Key" + key.toUpperCase()
                : /^\d$/.test(key)
                  ? "Digit" + key
                  : key;
        target.dispatchEvent(
          new win.KeyboardEvent(down ? "keydown" : "keyup", {
            key,
            code,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    },
  };
}
export type CanvasInput = ReturnType<typeof installCanvasInput>;
export type CanvasControls = ReturnType<CanvasInput["bind"]>;
