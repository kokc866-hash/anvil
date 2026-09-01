import { useBrain } from "./store";

export type BrainPri = 0 | 1 | 2;

const JOB_MS: Record<string, number> = {
  intent: 800,
  attach: 1600,
  compact: 1600,
  title: 2200,
  distill: 2500,
  followup: 2500,
  review: 2200,
  prompts: 2500,
  complete: 1500,
  palette: 900,
  commit: 2200,
  errors: 2200,
  diffs: 1600,
  search: 1400,
  rename: 1600,
  runpick: 1400,
  fixline: 1600,
  tabHint: 1200,
  secrets: 900,
  mention: 1200,
  stopNote: 1600,
  planText: 1400,
  comment: 1600,
  i18n: 900,
  logTrim: 1400,
  help: 800,
  usage: 2000,
  ask: 8000,
  ping: 4000,
  warm: 6000,
  shader: 20_000,
};

function jobMs(key: string) {
  return JOB_MS[key.split(":")[0] ?? ""] ?? 2500;
}

type Item<T> = {
  pri: BrainPri;
  key: string;
  fn: () => Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
  t: number;
};

const q: Item<unknown>[] = [];
let running = false;
let hold = false;
const cache = new Map<string, { t: number; v: string }>();

function pump() {
  if (running) return;
  if (hold) {
    useBrain.getState().setBusy(false);
    return;
  }
  const next = q.shift();
  if (!next) {
    useBrain.getState().setBusy(false);
    return;
  }
  running = true;
  useBrain.getState().setBusy(true);
  const started = Date.now();
  const timer = setTimeout(() => {
    void import("./engine").then((m) => m.interruptBrain());
    next.reject(new Error("timeout"));
  }, jobMs(next.key));
  next
    .fn()
    .then((v) => {
      clearTimeout(timer);
      next.resolve(v);
      useBrain.getState().logJob(next.key, "llm", Date.now() - started);
    })
    .catch((e) => {
      clearTimeout(timer);
      next.reject(e);
    })
    .finally(() => {
      running = false;
      pump();
    });
}

export function setHelperHold(v: boolean) {
  hold = v;
  if (v) {
    clearBrainQueue();
    void import("./engine").then((m) => m.interruptBrain());
    return;
  }
  pump();
}

export function helperHeld(): boolean {
  return hold;
}

export function enqueueBrain<T>(pri: BrainPri, key: string, fn: () => Promise<T>): Promise<T> {
  for (let i = q.length - 1; i >= 0; i--) {
    if (q[i].key === key) {
      q[i].reject(Object.assign(new Error("superseded"), { name: "Superseded" }));
      q.splice(i, 1);
    }
  }
  return new Promise<T>((resolve, reject) => {
    q.push({ pri, key, fn: fn as () => Promise<unknown>, resolve: resolve as (v: unknown) => void, reject, t: Date.now() });
    q.sort((a, b) => a.pri - b.pri || a.t - b.t);
    pump();
  });
}

export function cacheGet(key: string): string | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > 50_000) {
    cache.delete(key);
    return null;
  }
  useBrain.getState().logJob(key.slice(0, 24), "cache", 0);
  return hit.v;
}

export function cacheSet(key: string, v: string) {
  if (cache.size > 48) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(key, { t: Date.now(), v });
}

export function cacheKey(parts: string[]) {
  let h = 0;
  const s = parts.join("\n");
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0;
  return `${parts[0] ?? "j"}:${h}`;
}

export function clearBrainQueue() {
  while (q.length) {
    const i = q.pop();
    i?.reject(new Error("cleared"));
  }
}