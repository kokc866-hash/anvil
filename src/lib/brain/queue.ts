import { useBrain } from "./store";
import { BrainJobQueue, type BrainPri } from "./job-queue";

export type { BrainPri } from "./job-queue";

const JOB_MS: Record<string, number> = {
  intent: 800,
  attach: 6000,
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

const queue = new BrainJobQueue(
  (busy) => useBrain.getState().setBusy(busy),
  (key, ms) => useBrain.getState().logJob(key, "llm", ms),
);
const cache = new Map<string, { t: number; v: string }>();

export function setHelperHold(v: boolean) {
  queue.setHold(v);
}

export function helperHeld(): boolean {
  return queue.isHeld();
}

export function enqueueBrain<T>(pri: BrainPri, key: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  return queue.enqueue(pri, key, jobMs(key), fn, Math.min(jobMs(key), 2500));
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
  queue.clear();
}

export function resetBrainQueue() {
  queue.reset();
  cache.clear();
}
