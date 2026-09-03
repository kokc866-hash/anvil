import { runFile } from "./run-client";
import { throwIfAborted } from "./abort";

const FRAME_ID = "anvil-loop-frame";

export type LoopShot = { image: string | null; logs: string[]; w?: number; h?: number };

let fails = 0;

export function resetLoopFails() {
  fails = 0;
}

export function noteLoopFail(ok: boolean, max: number) {
  if (ok) {
    fails = 0;
    return { left: max, again: false };
  }
  fails += 1;
  return { left: Math.max(0, max - fails), again: fails < max };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function host(): HTMLIFrameElement {
  let el = document.getElementById(FRAME_ID) as HTMLIFrameElement | null;
  if (!el) {
    el = document.createElement("iframe");
    el.id = FRAME_ID;
    el.title = "Run-Loop";
    el.setAttribute("sandbox", "allow-scripts allow-pointer-lock allow-forms");
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = "position:fixed;left:-1200px;top:0;width:960px;height:540px;opacity:0;pointer-events:none;border:0";
    el.tabIndex = -1;
    document.body.appendChild(el);
  }
  return el;
}

function targets(): Window[] {
  const out: Window[] = [];
  const nodes = document.querySelectorAll("iframe");
  for (const f of nodes) {
    const title = (f.getAttribute("title") || f.id || "").toLowerCase();
    if (title && !/run|spiel|loop|preview/i.test(title) && f.id !== FRAME_ID) continue;
    try {
      if (f.contentWindow) out.push(f.contentWindow);
    } catch {
      /* cross-origin */
    }
  }
  return out.length ? out : [];
}

let lastHtml = "";

export async function loadLoop(html: string): Promise<void> {
  if (html === lastHtml && document.getElementById(FRAME_ID)) {
    await sleep(80);
    return;
  }
  lastHtml = html;
  const el = host();
  await new Promise<void>((res) => {
    const t = window.setTimeout(res, 2500);
    el.onload = () => {
      window.clearTimeout(t);
      try {
        el.blur();
        window.focus();
      } catch {
        /* ignore */
      }
      res();
    };
    try {
      el.srcdoc = html;
    } catch {
      window.clearTimeout(t);
      res();
    }
  });
  await sleep(200);
}

function grabCanvas(win: Window): string | null {
  try {
    const nodes = win.document.querySelectorAll("canvas");
    for (const c of nodes) {
      if (c.width < 8 || c.height < 8) continue;
      const url = c.toDataURL("image/png");
      if (url.length > 80) return url;
    }
  } catch {
    /* cross-origin */
  }
  return null;
}

function ask(op: "shot" | "logs"): Promise<LoopShot> {
  const wins = targets();
  for (const w of wins) {
    const url = grabCanvas(w);
    if (url) return Promise.resolve({ image: url, logs: [], w: 0, h: 0 });
  }
  if (!wins.length) return Promise.resolve({ image: null, logs: [] });
  return new Promise((res) => {
    const t = window.setTimeout(() => {
      window.removeEventListener("message", on);
      res({ image: null, logs: [] });
    }, 900);
    function on(ev: MessageEvent) {
      if (!wins.includes(ev.source as Window)) return;
      const d = ev.data as { anvil?: number; op?: string; url?: string; logs?: string[]; w?: number; h?: number };
      if (d?.anvil !== 1 || (d.op !== "shot" && d.op !== "logs")) return;
      if (op === "shot" && d.op !== "shot") return;
      window.clearTimeout(t);
      window.removeEventListener("message", on);
      res({
        image: typeof d.url === "string" && d.url.startsWith("data:image") && d.url.length > 80 ? d.url : null,
        logs: Array.isArray(d.logs) ? d.logs.map(String).slice(-16) : [],
        w: d.w,
        h: d.h,
      });
    }
    window.addEventListener("message", on);
    for (const w of wins) {
      try {
        w.postMessage({ anvil: 1, op }, "*");
      } catch {
        /* ignore */
      }
    }
  });
}

export async function shotLoop(html?: string): Promise<LoopShot> {
  let shot = await ask("shot");
  if (shot.image) return shot;
  if (html) {
    await loadLoop(html);
    shot = await ask("shot");
  }
  return shot;
}

const KEY_ALIAS: Record<string, string> = {
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
  ok: "ArrowUp",
  fire: " ",
  start: "Enter",
  space: " ",
  a: "a",
  b: " ",
  w: "w",
  s: "s",
  d: "d",
};

function mapKeys(raw: string[]): string[] {
  return raw
    .flatMap((k) => k.split(/[,\s]+/))
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => KEY_ALIAS[k.toLowerCase()] ?? k)
    .slice(0, 24);
}

export async function playLoop(keys: string[], holdMs = 90): Promise<LoopShot> {
  const wins = targets();
  const seq = mapKeys(keys);
  if (!wins.length || !seq.length) return shotLoop();
  for (const k of seq) {
    for (const w of wins) {
      try {
        w.postMessage({ anvil: 1, op: "keys", keys: [k] }, "*");
      } catch {
        /* ignore */
      }
    }
    await sleep(Math.min(400, Math.max(40, holdMs)));
    for (const w of wins) {
      try {
        w.postMessage({ anvil: 1, op: "keys-up", keys: [k] }, "*");
      } catch {
        /* ignore */
      }
    }
    await sleep(40);
  }
  await sleep(180);
  return shotLoop();
}

export async function runLoopFile(path: string, files: Record<string, string>, opts?: { graph?: boolean; tries?: number }) {
  throwIfAborted();
  const r = await runFile(path, files);
  let shot: LoopShot = { image: null, logs: [] };
  if (opts?.graph !== false && r.html) {
    await loadLoop(r.html);
    shot = await shotLoop();
  }
  const budget = noteLoopFail(r.ok, Math.min(5, Math.max(1, opts?.tries ?? 3)));
  return {
    ok: r.ok,
    stdout: (r.stdout || "").slice(0, 16000),
    stderr: (r.stderr || shot.logs.filter((l) => l.startsWith("error")).join("\n")).slice(0, 16000),
    logs: shot.logs,
    duration: r.duration,
    graphical: Boolean(r.html),
    html: r.html,
    image: shot.image ?? undefined,
    size: shot.w && shot.h ? `${shot.w}×${shot.h}` : undefined,
    tries_left: budget.left,
    hint: r.ok ? undefined : budget.again ? "Error. Patch and run_file again." : "No tries left this round.",
  };
}
