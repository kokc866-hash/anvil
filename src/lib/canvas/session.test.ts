import assert from "node:assert/strict";
import { test } from "node:test";
import { registerCanvasFrame } from "./session.ts";
import type { CanvasBoot } from "./protocol.ts";

function fixture() {
  const prior = globalThis.window;
  const values = () => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) || null,
      setItem: (k: string, v: string) => map.set(k, v),
    };
  };
  const win = Object.assign(new EventTarget(), {
    localStorage: values(),
    sessionStorage: values(),
  });
  globalThis.window = win as unknown as Window & typeof globalThis;
  let boot: CanvasBoot | undefined,
    source = "";
  const sent: Record<string, unknown>[] = [];
  let auto = true;
  const contentWindow = {
    postMessage(data: Record<string, unknown>) {
      sent.push(data);
      if (auto && data.op !== "dispose") queueMicrotask(() => reply(data));
    },
  };
  const reply = (data: Record<string, unknown>, foreign = false) => {
    const event = Object.assign(new Event("message"), {
      source: foreign ? {} : contentWindow,
      data: { ...data, ok: true, state: "running", logs: [] },
    });
    win.dispatchEvent(event);
  };
  const el = {
    contentWindow,
    onload: null as (() => void) | null,
    src: "",
    get srcdoc() {
      return source;
    },
    set srcdoc(html: string) {
      source = html;
      const cfg = html.match(/window\.__ANVIL_SESSION__=(.*?)<\/script>/s);
      boot = cfg ? JSON.parse(cfg[1]) : undefined;
      queueMicrotask(() => el.onload?.());
    },
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 320, height: 200 }),
    removeAttribute() {},
  };
  return {
    el: el as unknown as HTMLIFrameElement,
    sent,
    reply,
    get boot() {
      return boot;
    },
    set auto(value: boolean) {
      auto = value;
    },
    restore() {
      globalThis.window = prior;
    },
  };
}
const html = "<html><head></head><body>game</body></html>";
test("same code is reused for observation, while Run creates a new session and rejects stale input", async () => {
  const f = fixture(),
    owner = registerCanvasFrame(f.el, { scope: "test" });
  try {
    const a = await owner.load(html),
      same = await owner.load(html),
      b = await owner.load(html, true);
    assert.equal(a.session, same.session);
    assert.notEqual(a.session, b.session);
    await assert.rejects(
      owner.command("keys", { keys: ["left"], expectedSession: a.session }),
      /ersetzt/,
    );
    assert.equal(f.sent.filter((d) => d.op === "keys").length, 0);
    await owner.command("stop");
    assert.match(f.el.srcdoc, /Gestoppt/);
    assert.equal((await owner.load(html)).state, "stopped");
    assert.equal((await owner.load(html, true)).ok, true);
  } finally {
    owner.dispose();
    f.restore();
  }
});
test("foreign windows and old sessions cannot satisfy a pending request", async () => {
  const f = fixture(),
    owner = registerCanvasFrame(f.el, { scope: "test" });
  try {
    await owner.load(html);
    f.auto = false;
    let resolved = false;
    const request = owner.command("keys", { keys: ["x"] }).then((r) => {
      resolved = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 0));
    const message = f.sent.at(-1)!;
    f.reply({ ...message, session: "old" });
    f.reply(message, true);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(resolved, false);
    f.reply(message);
    assert.equal((await request).ok, true);
  } finally {
    owner.dispose();
    f.restore();
  }
});
test("abort during startup terminates the document and rejects the original load", async () => {
  const f = fixture(),
    owner = registerCanvasFrame(f.el, { scope: "test" }),
    abort = new AbortController();
  try {
    f.auto = false;
    const load = owner.load(html, true, abort.signal);
    const rejection = assert.rejects(load, /gestoppt/);
    await new Promise((r) => setTimeout(r, 0));
    abort.abort();
    await rejection;
    assert.match(f.el.srcdoc, /Gestoppt/);
    assert.equal((await owner.command("ready")).state, "stopped");
  } finally {
    owner.dispose();
    f.restore();
  }
});
test("native snapshot is discarded if its document changes during capture", async () => {
  const f = fixture();
  let owner: ReturnType<typeof registerCanvasFrame>;
  owner = registerCanvasFrame(f.el, {
    scope: "test",
    capture: async () => {
      await owner.load(html + "new", true);
      return "data:image/png;base64,fixture";
    },
  });
  try {
    await owner.load(html);
    await assert.rejects(owner.command("shot"), /ersetzt/);
  } finally {
    owner.dispose();
    f.restore();
  }
});
