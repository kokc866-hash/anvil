/** Injected into HTML/JS as global `Anvil` — 2D runtime for apps, sketches, tools. */
export const ANVIL_ENGINE = `(function (global) {
  try {
    var ls = global.localStorage;
    ls.setItem("__anvil", "1");
    ls.removeItem("__anvil");
  } catch (err) {
    var mem = {};
    var fake = {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); },
      removeItem: function (k) { delete mem[k]; },
      clear: function () { mem = {}; },
      key: function (i) { return Object.keys(mem)[i] || null; }
    };
    Object.defineProperty(fake, "length", { get: function () { return Object.keys(mem).length; } });
    try { Object.defineProperty(global, "localStorage", { value: fake }); } catch (e2) { global.localStorage = fake; }
    try { Object.defineProperty(global, "sessionStorage", { value: fake }); } catch (e3) { global.sessionStorage = fake; }
  }

  function bootDom() {
    try {
      var doc = global.document;
      if (!doc || doc.__anvilDom) return;
      doc.__anvilDom = true;
      doc.addEventListener("submit", function (e) { e.preventDefault(); }, true);
      doc.addEventListener("click", function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var b = t.closest("button");
        if (b && !b.getAttribute("type")) b.setAttribute("type", "button");
        var a = t.closest("a");
        if (a && (!a.getAttribute("href") || a.getAttribute("href") === "#")) e.preventDefault();
      }, true);
      doc.addEventListener("pointerdown", function () {
        try { if (global.Anvil && Anvil._audio) Anvil._audio(); } catch (e) {}
      }, true);
    } catch (e) {}
  }
  if (global.document && global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", bootDom);
  } else bootDom();

  var MAP = global.__ANVIL_INPUT__ || {
    left: { keys: ["ArrowLeft", "a", "A"], pad: [14] },
    right: { keys: ["ArrowRight", "d", "D"], pad: [15] },
    up: { keys: ["ArrowUp", "w", "W"], pad: [12] },
    down: { keys: ["ArrowDown", "s", "S"], pad: [13] },
    ok: { keys: ["Enter", " ", "x", "X"], pad: [0] },
    fire: { keys: [" ", "f", "F"], pad: [1, 7] },
    start: { keys: ["Escape", "p", "P"], pad: [9, 8] },
    stick: true,
    deadzone: 0.28
  };
  if (global.Anvil && global.Anvil._ok) {
    if (global.__ANVIL_INPUT__) MAP = global.__ANVIL_INPUT__;
    global.Anvil.map = applyMap;
    return;
  }

  var keys = new Set();
  var just = new Set();
  var released = new Set();
  var mouse = {
    x: 0, y: 0, wx: 0, wy: 0, down: false, clicked: false, buttons: 0,
    left: false, right: false, middle: false,
    pressed: false, released: false, wheel: 0, dx: 0, dy: 0
  };
  var lastMX = 0, lastMY = 0;
  var padHeld = {};
  var pad = {
    connected: false, ax: 0, ay: 0, ax2: 0, ay2: 0,
    left: false, right: false, up: false, down: false,
    a: false, b: false, x: false, y: false, l: false, r: false, start: false,
    aPressed: false, bPressed: false, xPressed: false, yPressed: false, startPressed: false,
    action: {}, actionPressed: {}
  };
  var actx = null;

  function applyMap(next) {
    if (!next) return MAP;
    MAP = next;
    global.__ANVIL_INPUT__ = next;
    return MAP;
  }
  function inList(set, list) {
    if (!list) return false;
    for (var i = 0; i < list.length; i++) if (set.has(list[i])) return true;
    return false;
  }
  function anyBtn(g, ids) {
    if (!g || !ids) return false;
    for (var i = 0; i < ids.length; i++) {
      var b = g.buttons[ids[i]];
      if (b && b.pressed) return true;
    }
    return false;
  }
  function edge(name, on) {
    var pressed = on && !padHeld[name];
    padHeld[name] = on;
    pad[name] = on;
    pad[name + "Pressed"] = pressed;
    pad.action[name] = on;
    pad.actionPressed[name] = pressed;
  }
  function readPad() {
    var list = navigator.getGamepads ? navigator.getGamepads() : [];
    var g = null;
    for (var i = 0; i < list.length; i++) if (list[i]) { g = list[i]; break; }
    pad.connected = !!g;
    var dz = MAP.deadzone || 0.28;
    if (!g) {
      ["left","right","up","down","ok","fire","start","a","b","x","y","l","r"].forEach(function (n) { edge(n, false); });
      pad.ax = 0; pad.ay = 0; pad.ax2 = 0; pad.ay2 = 0;
      return;
    }
    var ax = Math.abs(g.axes[0]) > dz ? g.axes[0] : 0;
    var ay = Math.abs(g.axes[1]) > dz ? g.axes[1] : 0;
    pad.ax = ax; pad.ay = ay;
    pad.ax2 = Math.abs(g.axes[2] || 0) > dz ? g.axes[2] : 0;
    pad.ay2 = Math.abs(g.axes[3] || 0) > dz ? g.axes[3] : 0;
    var stick = MAP.stick !== false;
    edge("left", anyBtn(g, MAP.left.pad) || (stick && ax < -0.45));
    edge("right", anyBtn(g, MAP.right.pad) || (stick && ax > 0.45));
    edge("up", anyBtn(g, MAP.up.pad) || (stick && ay < -0.45));
    edge("down", anyBtn(g, MAP.down.pad) || (stick && ay > 0.45));
    edge("ok", anyBtn(g, MAP.ok.pad));
    edge("fire", anyBtn(g, MAP.fire.pad));
    edge("start", anyBtn(g, MAP.start.pad));
    edge("a", !!(g.buttons[0] && g.buttons[0].pressed));
    edge("b", !!(g.buttons[1] && g.buttons[1].pressed));
    edge("x", !!(g.buttons[2] && g.buttons[2].pressed));
    edge("y", !!(g.buttons[3] && g.buttons[3].pressed));
    edge("l", !!(g.buttons[4] && g.buttons[4].pressed));
    edge("r", !!(g.buttons[5] && g.buttons[5].pressed));
  }
  function audio() {
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    if (!actx) actx = new AC();
    if (actx.state === "suspended") actx.resume();
    return actx;
  }
  function beep(freq, ms, type) {
    try {
      var c = audio();
      if (!c) return;
      var o = c.createOscillator();
      var g = c.createGain();
      o.type = type || "sine";
      o.frequency.value = freq || 440;
      g.gain.setValueAtTime(0.06, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + (ms || 80) / 1000);
      o.connect(g); g.connect(c.destination);
      o.start();
      o.stop(c.currentTime + (ms || 80) / 1000);
    } catch (e) {}
  }
  function pointOn(canvas, cx, cy) {
    var r = canvas.getBoundingClientRect();
    var sx = (canvas._cssW || canvas.width) / Math.max(1, r.width);
    var sy = (canvas._cssH || canvas.height) / Math.max(1, r.height);
    mouse.dx = (cx - r.left) * sx - mouse.x;
    mouse.dy = (cy - r.top) * sy - mouse.y;
    mouse.x = (cx - r.left) * sx;
    mouse.y = (cy - r.top) * sy;
  }
  function bind(canvas) {
    if (canvas.__anvilBound) return;
    canvas.__anvilBound = true;
    canvas.tabIndex = canvas.tabIndex >= 0 ? canvas.tabIndex : 0;
    canvas.style.outline = canvas.style.outline || "none";
    canvas.style.touchAction = "none";
    function typing(e) {
      var t = e.target;
      var tag = (t && t.tagName) || "";
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable);
    }
    function onKey(e, down) {
      if (down) {
        if (!keys.has(e.key)) just.add(e.key);
        keys.add(e.key);
        keys.add(e.code);
      } else {
        keys.delete(e.key);
        keys.delete(e.code);
        released.add(e.key);
        released.add(e.code);
      }
      if (!typing(e) && (e.key === " " || e.key.indexOf("Arrow") === 0 || e.key === "Tab")) e.preventDefault();
    }
    global.addEventListener("keydown", function (e) { onKey(e, true); });
    global.addEventListener("keyup", function (e) { onKey(e, false); });
    canvas.addEventListener("pointermove", function (e) { pointOn(canvas, e.clientX, e.clientY); });
    canvas.addEventListener("pointerdown", function (e) {
      pointOn(canvas, e.clientX, e.clientY);
      mouse.down = true; mouse.clicked = true; mouse.pressed = true;
      mouse.buttons = e.buttons;
      mouse.left = !!(e.buttons & 1);
      mouse.right = !!(e.buttons & 2);
      mouse.middle = !!(e.buttons & 4);
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      try { canvas.focus(); } catch (err2) {}
    });
    canvas.addEventListener("pointerup", function (e) {
      mouse.down = false; mouse.released = true; mouse.buttons = e.buttons; mouse.left = false;
    });
    canvas.addEventListener("wheel", function (e) { mouse.wheel += e.deltaY; e.preventDefault(); }, { passive: false });
    canvas.addEventListener("touchstart", function (e) {
      if (e.touches && e.touches[0]) pointOn(canvas, e.touches[0].clientX, e.touches[0].clientY);
      mouse.down = true; mouse.clicked = true; mouse.pressed = true;
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener("touchend", function () { mouse.down = false; mouse.released = true; });
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    global.addEventListener("blur", function () { keys.clear(); mouse.down = false; });
  }

  function fitCanvas(canvas, cssW, cssH, mode) {
    canvas._cssW = cssW; canvas._cssH = cssH;
    var parent = canvas.parentElement || document.body;
    var pw = parent.clientWidth || cssW;
    var ph = parent.clientHeight || cssH;
    if (!mode || mode === "none") {
      canvas.style.width = cssW + "px";
      canvas.style.height = cssH + "px";
      return;
    }
    if (mode === "fill") {
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      return;
    }
    var s = mode === "cover" ? Math.max(pw / cssW, ph / cssH) : Math.min(pw / cssW, ph / cssH);
    if (!isFinite(s) || s <= 0) s = 1;
    canvas.style.width = Math.round(cssW * s) + "px";
    canvas.style.height = Math.round(cssH * s) + "px";
  }

  function toWorld(cam, w, h, x, y) {
    var z = cam.z || 1;
    var dx = x - w / 2;
    var dy = y - h / 2;
    var c = Math.cos(-(cam.r || 0));
    var s = Math.sin(-(cam.r || 0));
    return { x: cam.x + (dx * c - dy * s) / z, y: cam.y + (dx * s + dy * c) / z };
  }

  function create(opts) {
    opts = opts || {};
    var w = opts.width || opts.w || 640;
    var h = opts.height || opts.h || 360;
    var canvas = opts.canvas && typeof opts.canvas !== "string"
      ? opts.canvas
      : (document.getElementById(opts.canvas || "c") || document.querySelector("canvas"));
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.id = "c";
      (opts.parent ? document.querySelector(opts.parent) : document.body).appendChild(canvas);
    }
    var dpr = opts.pixel ? 1 : Math.min(2, global.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    fitCanvas(canvas, w, h, opts.fit || "contain");
    var ctx = canvas.getContext("2d", { alpha: opts.alpha !== false });
    var gl = null;
    if (opts.gl) {
      try { gl = canvas.getContext("webgl2") || canvas.getContext("webgl"); } catch (e) { gl = null; }
    }
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = opts.smooth !== false && !opts.pixel;
    }
    bind(canvas);
    var bg = opts.background || opts.bg || "#0a0a0b";
    var rafId = 0;
    var running = false;
    var game = {
      canvas: canvas, ctx: ctx, gl: gl, width: w, height: h, dpr: dpr,
      dt: 0, time: 0, fps: 0, paused: false, timeScale: 1, scene: opts.scene || "main",
      cam: { x: w / 2, y: h / 2, z: 1, r: 0 },
      key: {
        down: function (k) { return keys.has(k); },
        pressed: function (k) { return just.has(k); },
        released: function (k) { return released.has(k); }
      },
      mouse: mouse, pad: pad, input: {},
      beep: beep,
      clamp: function (n, a, b) { return Math.max(a, Math.min(b, n)); },
      lerp: function (a, b, t) { return a + (b - a) * t; },
      ease: function (t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); },
      dist: function (ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); },
      hit: function (ax, ay, aw, ah, bx, by, bw, bh) {
        return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
      },
      pointIn: function (px, py, x, y, rw, rh) { return px >= x && py >= y && px <= x + rw && py <= y + rh; },
      rand: function (a, b) { return b == null ? Math.random() * a : a + Math.random() * (b - a); },
      color: function (h, s, l, a) {
        return "hsla(" + (h || 0) + "," + (s == null ? 70 : s) + "%," + (l == null ? 50 : l) + "%," + (a == null ? 1 : a) + ")";
      },
      world: function () {
        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.rotate(game.cam.r || 0);
        ctx.scale(game.cam.z || 1, game.cam.z || 1);
        ctx.translate(-game.cam.x, -game.cam.y);
      },
      hud: function () { ctx.restore(); },
      toWorld: function (x, y) { return toWorld(game.cam, w, h, x == null ? mouse.x : x, y == null ? mouse.y : y); },
      clear: function (color) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = color || bg;
        ctx.fillRect(0, 0, w, h);
      },
      rect: function (x, y, rw, rh, color) { ctx.fillStyle = color; ctx.fillRect(x, y, rw, rh); },
      round: function (x, y, rw, rh, r, color) {
        var rr = Math.min(r || 8, rw / 2, rh / 2);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + rw, y, x + rw, y + rh, rr);
        ctx.arcTo(x + rw, y + rh, x, y + rh, rr);
        ctx.arcTo(x, y + rh, x, y, rr);
        ctx.arcTo(x, y, x + rw, y, rr);
        ctx.closePath(); ctx.fill();
      },
      stroke: function (x, y, rw, rh, color, lw) {
        ctx.strokeStyle = color; ctx.lineWidth = lw || 1; ctx.strokeRect(x, y, rw, rh);
      },
      circle: function (x, y, r, color) {
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      },
      ring: function (x, y, r, color, lw) {
        ctx.strokeStyle = color; ctx.lineWidth = lw || 2; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      },
      line: function (x1, y1, x2, y2, color, lw) {
        ctx.strokeStyle = color || "#ececec"; ctx.lineWidth = lw || 1;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      },
      poly: function (pts, color, fill) {
        if (!pts || !pts.length) return;
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
        for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        if (fill !== false) { ctx.fillStyle = color; ctx.fill(); }
        else { ctx.strokeStyle = color; ctx.stroke(); }
      },
      grid: function (step, color) {
        step = step || 32;
        ctx.strokeStyle = color || "rgba(255,255,255,0.06)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var x = 0; x <= w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
        for (var y = 0; y <= h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
        ctx.stroke();
      },
      text: function (s, x, y, color, size, align) {
        ctx.fillStyle = color || "#ececec";
        ctx.font = (size ? size + "px " : "") + (opts.font || "13px ui-sans-serif, system-ui, sans-serif");
        if (align) ctx.textAlign = align;
        ctx.textBaseline = "top";
        ctx.fillText(s, x, y);
        ctx.textAlign = "start";
      },
      measure: function (s, size) {
        ctx.font = (size ? size + "px " : "") + (opts.font || "13px ui-sans-serif, system-ui, sans-serif");
        return ctx.measureText(String(s)).width;
      },
      image: function (img, x, y, rw, rh) {
        if (!img) return;
        if (rw == null) ctx.drawImage(img, x, y);
        else ctx.drawImage(img, x, y, rw, rh);
      },
      sprite: function (img, sx, sy, sw, sh, dx, dy, dw, dh) {
        if (!img) return;
        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw == null ? sw : dw, dh == null ? sh : dh);
      },
      alpha: function (a, fn) {
        var prev = ctx.globalAlpha;
        ctx.globalAlpha = a;
        if (fn) { fn(); ctx.globalAlpha = prev; }
      },
      png: function () { return canvas.toDataURL("image/png"); },
      resize: function (nw, nh) {
        w = nw; h = nh; game.width = w; game.height = h;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        fitCanvas(canvas, w, h, opts.fit || "contain");
        if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      },
      pause: function (on) { game.paused = on !== false; },
      stop: function () { running = false; if (rafId) cancelAnimationFrame(rafId); rafId = 0; },
      start: function () {
        if (running) return game;
        running = true;
        var last = performance.now();
        if (typeof game.draw === "function") {
          try { game.draw(); } catch (e0) { console.error(e0); }
        }
        function loop(t) {
          if (!running) return;
          rafId = requestAnimationFrame(loop);
          var raw = Math.min(0.05, (t - last) / 1000);
          last = t;
          var world = toWorld(game.cam, w, h, mouse.x, mouse.y);
          mouse.wx = world.x; mouse.wy = world.y;
          if (game.paused) {
            just.clear(); released.clear();
            mouse.clicked = mouse.pressed = mouse.released = false; mouse.wheel = 0; mouse.dx = 0; mouse.dy = 0;
            return;
          }
          var dt = raw * (game.timeScale || 1);
          game.dt = dt; game.time += dt; game.fps = raw > 0 ? Math.round(1 / raw) : 0;
          readPad();
          try {
            if (typeof game.update === "function") game.update(dt);
            if (typeof game.draw === "function") game.draw();
          } catch (err) { console.error(err); }
          just.clear(); released.clear();
          mouse.clicked = mouse.pressed = mouse.released = false; mouse.wheel = 0; mouse.dx = 0; mouse.dy = 0;
        }
        rafId = requestAnimationFrame(loop);
        try { canvas.focus(); } catch (e) {}
        return game;
      }
    };
    Object.defineProperties(game.input, {
      left: { get: function () { return inList(keys, MAP.left.keys) || pad.left; } },
      right: { get: function () { return inList(keys, MAP.right.keys) || pad.right; } },
      up: { get: function () { return inList(keys, MAP.up.keys) || pad.up; } },
      down: { get: function () { return inList(keys, MAP.down.keys) || pad.down; } },
      ok: { get: function () { return inList(just, MAP.ok.keys) || pad.okPressed; } },
      fire: { get: function () { return inList(just, MAP.fire.keys) || pad.firePressed; } },
      start: { get: function () { return inList(just, MAP.start.keys) || pad.startPressed; } }
    });
    if (opts.fit && opts.fit !== "none" && global.ResizeObserver) {
      try {
        new ResizeObserver(function () { fitCanvas(canvas, w, h, opts.fit); }).observe(canvas.parentElement || document.body);
      } catch (e) {}
    }
    return game;
  }

  function attach(el) {
    var canvas = typeof el === "string" ? document.getElementById(el) || document.querySelector(el) : el;
    if (!canvas) return null;
    canvas._cssW = canvas._cssW || canvas.width;
    canvas._cssH = canvas._cssH || canvas.height;
    bind(canvas);
    return { canvas: canvas, mouse: mouse, pad: pad, key: {
      down: function (k) { return keys.has(k); },
      pressed: function (k) { return just.has(k); },
      released: function (k) { return released.has(k); }
    } };
  }

  function loadImage(src) {
    return new Promise(function (ok, bad) {
      var img = new Image();
      img.onload = function () { ok(img); };
      img.onerror = function () { bad(new Error("Bild: " + src)); };
      img.src = src;
    });
  }

  var logs = [];
  function pushLog(level, args) {
    var t = "";
    try { for (var i = 0; i < args.length; i++) t += (i ? " " : "") + args[i]; }
    catch (e) { t = String(args); }
    logs.push(level + ": " + String(t).slice(0, 240));
    if (logs.length > 40) logs.shift();
  }
  ["log", "warn", "error"].forEach(function (fn) {
    var orig = console[fn] && console[fn].bind(console);
    console[fn] = function () {
      pushLog(fn === "log" ? "log" : fn, arguments);
      if (orig) orig.apply(console, arguments);
    };
  });
  global.addEventListener("error", function (e) { pushLog("error", [e.message]); });
  global.addEventListener("unhandledrejection", function (e) {
    pushLog("error", [e.reason && e.reason.message ? e.reason.message : e.reason]);
  });
  global.addEventListener("message", function (ev) {
    var d = ev.data;
    if (!d || d.anvil !== 1) return;
    if (d.op === "keys") (d.keys || []).forEach(function (k) { keys.add(k); just.add(k); });
    if (d.op === "keys-up") (d.keys || []).forEach(function (k) { keys.delete(k); released.add(k); });
    if (d.op === "shot" || d.op === "logs") {
      var c = document.querySelector("canvas");
      var url = "";
      if (d.op === "shot" && c) {
        try {
          var max = 640, sw = c.width || 1, sh = c.height || 1;
          var sc = Math.min(1, max / Math.max(sw, sh));
          if (sc < 1) {
            var off = document.createElement("canvas");
            off.width = Math.max(1, Math.round(sw * sc));
            off.height = Math.max(1, Math.round(sh * sc));
            off.getContext("2d").drawImage(c, 0, 0, off.width, off.height);
            url = off.toDataURL("image/jpeg", 0.62);
          } else url = c.toDataURL("image/jpeg", 0.7);
        } catch (err) {}
      }
      try { parent.postMessage({ anvil: 1, op: d.op, url: url, w: c && c.width, h: c && c.height, logs: logs.slice(-16) }, "*"); }
      catch (err2) {}
    }
  });

  global.Anvil = {
    _ok: true,
    _audio: audio,
    map: applyMap,
    beep: beep,
    attach: attach,
    loadImage: loadImage,
    create: create,
    run: function (opts) {
      var g = create(opts);
      if (opts.update) g.update = function (dt) { opts.update.call(g, dt); };
      if (opts.draw) g.draw = function () { opts.draw.call(g); };
      g.start();
      return g;
    }
  };
})(window);`;
