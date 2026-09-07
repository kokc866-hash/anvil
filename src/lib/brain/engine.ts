import { useIde } from "@/store/ide";
import { captureBrainScope, bindBrainScope, brainCanceled } from "./scope";
import { removeModelCache } from "./model-cache";
import { helperText } from "./text";
import { installRuntimeEnvironment, LOCAL_MODEL_ORIGIN, type RuntimeEnvironment } from "./runtime-environment";
import { cacheGet, cacheKey, cacheSet, resetBrainQueue, enqueueBrain, helperHeld, type BrainPri } from "./queue";
import { activeModelId, brainReady, useBrain } from "./store";
import { BRAIN_MODELS, brainModelOf, resolveBrainId } from "./models";
import { cacheOrder } from "../model-lib";
import { downloadHelperLocal, helperLocalId, helperLocalUrls, nativeHelper, syncHelperAuth, captureHelperLocal, cancelHelperLocal } from "../helper-local";

type ChatMsg = { role: string; content: string };

type Engine = {
  chat: {
    completions: {
      create: (opts: Record<string, unknown>) => Promise<unknown>;
    };
  };
  unload?: () => Promise<void>;
  reload?: (id: string | string[], opts?: Record<string, unknown>) => Promise<void>;
  interruptGenerate?: () => Promise<void>;
  setLogLevel?: (l: string) => void;
};

let engine: Engine | null = null;
let worker: Worker | null = null;
let visBound = false;
let gpuCache: { t: number; v: Awaited<ReturnType<typeof gpuInfoFresh>> } | null = null;
let hideTimer = 0;
let warming = false;
let loadSequence = 0;
type LoadTicket = { id: number; wanted: string; ctrl: AbortController; cancel?: () => void; promise: Promise<void> };
let loading: LoadTicket | null = null;
let loadTail: Promise<void> = Promise.resolve();
let lifetimeBound = false;
let lastUse = 0;
let session = 0;
let retiringMain: Promise<void> | null = null;
let updatePromise: Promise<string> | null = null;
let keepAliveTimer: ReturnType<typeof setTimeout> | undefined;


async function webllm() {
  return import("@mlc-ai/web-llm");
}

function bindVisibility() {
  if (visBound || typeof document === "undefined") return;
  visBound = true;
  document.addEventListener("visibilitychange", () => {
    window.clearTimeout(hideTimer);
    if (!document.hidden) return;
    const hiddenEngine = engine;
    hideTimer = window.setTimeout(() => {
      if (document.hidden && !warming && engine === hiddenEngine) void engine?.interruptGenerate?.();
    }, 12_000);
  });
}

async function gpuInfoFresh(): Promise<{
  ok: boolean;
  fp16: boolean;
  info: string;
  vendor: string;
  maxBuffer: number;
}> {
  const nav = navigator as Navigator & {
    gpu?: {
      requestAdapter: (opts?: { powerPreference?: string }) => Promise<{
        features: { has: (f: string) => boolean };
        info?: { device?: string; vendor?: string; architecture?: string };
        limits?: { maxBufferSize?: number; maxStorageBufferBindingSize?: number };
      } | null>;
    };
  };
  if (!nav.gpu) return { ok: false, fp16: false, info: "Kein WebGPU (Chrome/Edge + GPU)", vendor: "", maxBuffer: 0 };
  try {
    const power = useBrain.getState().gpuPower;
    const a = await nav.gpu.requestAdapter({ powerPreference: power });
    if (!a) return { ok: false, fp16: false, info: "Kein GPU-Adapter", vendor: "", maxBuffer: 0 };
    const fp16 = a.features.has("shader-f16");
    const vendor = a.info?.vendor || "";
    const device = a.info?.device || a.info?.architecture || "";
    const maxBuffer = a.limits?.maxStorageBufferBindingSize ?? a.limits?.maxBufferSize ?? 0;
    const tag = [power === "high-performance" ? "perf" : "spar", fp16 ? "fp16" : "fp32", vendor, device].filter(Boolean).join(" · ");
    return { ok: true, fp16, info: tag || "WebGPU", vendor, maxBuffer };
  } catch {
    return { ok: false, fp16: false, info: "WebGPU blockiert", vendor: "", maxBuffer: 0 };
  }
}

export async function gpuInfo(): Promise<{
  ok: boolean;
  fp16: boolean;
  info: string;
  vendor: string;
  maxBuffer: number;
}> {
  if (gpuCache && gpuCache.v.info.startsWith(useBrain.getState().gpuPower === "high-performance" ? "perf" : "spar") && Date.now() - gpuCache.t < 20_000) return gpuCache.v;
  const v = await gpuInfoFresh();
  gpuCache = { t: Date.now(), v };
  return v;
}

function fitContext(want: number, maxBuffer: number, vramMb: number): number {
  let ctx = Math.max(1024, Math.round(want / 1024) * 1024);
  const st = useBrain.getState();
  if (!st.gpuFitBuffer || maxBuffer <= 0) return Math.min(32768, ctx);
  const perTok = vramMb >= 1600 ? 12_288 : 8_192;
  const cap = Math.floor((maxBuffer * 0.32) / perTok);
  if (cap >= 1024) ctx = Math.min(ctx, Math.floor(cap / 1024) * 1024);
  return Math.min(32768, Math.max(1024, ctx));
}

function chatOpts(id: string, overrides?: { context_window_size?: number; sliding_window_size?: number }) {
  const st = useBrain.getState();
  const spec = brainModelOf(id);
  const limit = overrides?.context_window_size && overrides.context_window_size > 0 ? overrides.context_window_size : 32768;
  const want = Math.min(st.context || 8192, spec?.ctx ?? 32768, limit);
  const ctx = fitContext(want, gpuCache?.v.maxBuffer ?? 0, spec?.vramMb ?? 1000);
  if (st.sliding) {
    return {
      context_window_size: -1,
      sliding_window_size: ctx,
      attention_sink_size: 4,
      repetition_penalty: st.repeatPenalty,
      temperature: st.temperature,
      top_p: 0.9,
      frequency_penalty: 0,
      presence_penalty: 0,
    };
  }
  return {
    context_window_size: ctx,
    sliding_window_size: -1,
    attention_sink_size: 0,
    repetition_penalty: st.repeatPenalty,
    temperature: st.temperature,
    top_p: 0.9,
    frequency_penalty: 0,
    presence_penalty: 0,
  };
}

function oomish(err: unknown) {
  const m = err instanceof Error ? err.message : String(err);
  return /oom|out of memory|device lost|exceeds|vram|buffer/i.test(m);
}

type CacheBackend = "opfs" | "indexeddb" | "cache";

function netish(err: unknown) {
  const m = err instanceof Error ? err.message : String(err);
  return /Cache\.add|network error|Failed to fetch|Failed to store|ERR_NETWORK|QUIC|Quota|OPFS|not ok|Unexpected end of JSON/i.test(m);
}

function nativeRecord(m: { model_id: string; model: string; model_lib: string }, revision = "legacy") {
  const root = `${LOCAL_MODEL_ORIGIN}/${m.model_id}/${encodeURIComponent(revision)}/`;
  return { ...m, model: root, model_lib: `${root}${m.model_lib.split("/").pop()}` };
}

async function createEngine(id: string, onProgress: (p: { progress: number; text: string }) => void, ticket: LoadTicket): Promise<{ engine: Engine; worker: Worker | null; config: string }> {
  const check = () => ticket.ctrl.signal.throwIfAborted();
  const llm = await webllm();
  check();
  const st = useBrain.getState();
  const record = llm.prebuiltAppConfig.model_list.find((m) => m.model_id === id);
  if (!record) throw new Error(`Unbekanntes WebLLM-Modell: ${id}`);
  const opts = chatOpts(id, record.overrides);
  let local = Boolean(await helperLocalId(id, true));
  check();
  if (!local && nativeHelper()) {
    onProgress({ progress: 0, text: "Auf die Festplatte…" });
    // Do not silently try a broken local URL or switch to an untracked download.
    await downloadHelperLocal(id, (p) => onProgress({ progress: p.total ? p.done / p.total : 0, text: `${p.rel} (${p.done}/${p.total})` }), { signal: ticket.ctrl.signal });
    check();
    local = Boolean(await helperLocalId(id));
    if (!local) throw new Error("Helfer-Dateien unvollständig. Download unter Modelle erneut starten.");
  }
  await syncHelperAuth();
  check();
  const revision = local ? (await nativeHelper()?.helperList())?.find((m) => m.id === id)?.revision || "legacy" : "";
  check();
  const routes: RuntimeEnvironment["routes"] = [];
  if (local) {
    const stable = nativeRecord(record, revision);
    const localUrls = helperLocalUrls(id, record.model_lib);
    routes.push({ from: stable.model, to: `${localUrls.model}/` }, { from: stable.model_lib, to: localUrls.model_lib });
  }
  const environment: RuntimeEnvironment = { power: st.gpuPower, routes };
  const model_list = llm.prebuiltAppConfig.model_list.map((m) => local && m.model_id === id ? nativeRecord(m, revision) : m);
  let last: unknown;
  for (const backend of cacheOrder()) {
    check();
    const cfg = { initProgressCallback: onProgress, logLevel: "ERROR" as const, appConfig: { model_list, cacheBackend: backend } };
    for (const inWorker of st.useWorker && typeof Worker !== "undefined" ? [true, false] : [false]) {
      let candidate: Engine | null = null;
      let candidateWorker: Worker | null = null;
      let restore = () => {};
      try {
        if (inWorker) {
          candidateWorker = new Worker(new URL("./gpu-worker.ts", import.meta.url), { type: "module" });
          candidateWorker.postMessage({ type: "anvil-helper-runtime", environment });
          candidate = new llm.WebWorkerMLCEngine(candidateWorker, cfg) as unknown as Engine;
        } else {
          restore = installRuntimeEnvironment(environment);
          candidate = new llm.MLCEngine(cfg) as unknown as Engine;
        }
        const owned = candidate;
        const ownedWorker = candidateWorker;
        let rejectAbort: (e: unknown) => void = () => {};
        const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
        ticket.cancel = () => {
          if (ownedWorker) { ownedWorker.terminate(); rejectAbort(brainCanceled()); }
          else void owned.unload?.().catch(() => undefined);
        };
        check();
        // Worker termination has no reply. Main-thread loading remains serialized
        // until its unload acknowledgement, so two GPU loads never overlap.
        await Promise.race([candidate.reload!(id, opts), aborted]);
        check();
        return { engine: candidate, worker: candidateWorker, config: `${opts.context_window_size > 0 ? opts.context_window_size : opts.sliding_window_size} Context · ${st.gpuPower === "high-performance" ? "Leistung" : "Sparsam"} · ${candidateWorker ? "Worker" : "GPU"}` };
      } catch (err) {
        if (candidateWorker) candidateWorker.terminate();
        else await candidate?.unload?.().catch(() => undefined);
        check();
        last = err;
        if (inWorker && !oomish(err) && !netish(err)) {
          onProgress({ progress: 0, text: "GPU-Worker nicht verfügbar · direkt auf der GPU laden…" });
          continue;
        }
        if (!netish(err)) throw err;
        onProgress({ progress: 0, text: `Cache ${backend} nicht verfügbar, alternative Ablage…` });
        break;
      } finally {
        ticket.cancel = undefined;
        restore();
      }
    }
  }
  throw last instanceof Error ? last : new Error("Helfer konnte nicht geladen werden");
}

function bindLifetime() {
  bindBrainScope();
  if (lifetimeBound) return;
  lifetimeBound = true;
  useBrain.subscribe((s, p) => {
    if (!s.on && p.on) void unloadBrain();
    if (loading && (s.modelId !== p.modelId || s.customId !== p.customId)) void unloadBrain();
    if (s.gpuKeepAlive !== p.gpuKeepAlive || s.status !== p.status || s.autonomy !== p.autonomy) scheduleKeepAlive();
  });
}

function scheduleKeepAlive() {
  clearTimeout(keepAliveTimer);
  const s = useBrain.getState();
  if (!s.gpuKeepAlive || s.autonomy === "off" || !brainReady()) return;
  keepAliveTimer = setTimeout(() => {
    const now = useBrain.getState();
    if (!document.hidden && !now.busy && !warming && !helperHeld() && !useIde.getState().agentBusy && Date.now() - lastUse >= 70_000) {
      void brainGenerate({ messages: [{ role: "user", content: "OK" }], maxTokens: 4, temperature: 0, pri: 2, job: "warm" })
        .catch(() => undefined).finally(scheduleKeepAlive);
    } else scheduleKeepAlive();
  }, 70_000);
}

export function loadBrain(force = false): Promise<void> {
  bindLifetime();
  const st = useBrain.getState();
  if (!st.on) return Promise.resolve();
  const wanted = activeModelId();
  const previousId = st.loadedId;
  if (loading?.wanted === wanted && !loading.ctrl.signal.aborted) return loading.promise;
  if (!force && engine && brainReady() && brainModelOf(st.loadedId)?.id === brainModelOf(wanted)?.id && (brainModelOf(wanted) || st.loadedId === wanted)) return Promise.resolve();
  loading?.ctrl.abort();
  loading?.cancel?.();
  const ticket: LoadTicket = { id: ++loadSequence, wanted, ctrl: new AbortController(), promise: Promise.resolve() };
  loading = ticket;
  const current = () => !ticket.ctrl.signal.aborted && ticket.id === loadSequence && useBrain.getState().on;
  const onProgress = (p: { progress: number; text: string }) => {
    if (current()) useBrain.getState().setStatus({ status: "downloading", progress: p.progress, progressText: p.text });
  };
  st.setStatus({ status: "downloading", error: "", progress: 0, progressText: "WebGPU / Modell…" });
  ticket.promise = loadTail.catch(() => {}).then(async () => {
    if (!current()) return;
    await disposeBrainEngine();
    await waitForMainRelease();
    if (!current()) return;
    bindVisibility();
    const gpu = await gpuInfo();
    if (!current()) return;
    useBrain.getState().setStatus({ gpu: gpu.info, fp16: gpu.fp16 });
    if (!gpu.ok) throw new Error(gpu.info);
    const id = resolveBrainId(wanted, gpu.fp16);
    try { await navigator.storage?.persist?.(); } catch { /* optional quota */ }
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!current()) return;
      try {
        const result = await createEngine(id, onProgress, ticket);
        if (!current()) {
          result.worker?.terminate();
          if (!result.worker) await result.engine.unload?.();
          return;
        }
        engine = result.engine;
        worker = result.worker;
        session++;
        lastUse = Date.now();
        useBrain.getState().setStatus({ status: "ready", loadedId: id, loadedConfig: result.config, progress: 1, progressText: "geladen · Antwort wird geprüft", error: "", cacheEpoch: useBrain.getState().cacheEpoch + 1 });
        // This check records the previous runtime version before updating it.
        if (st.autoUpdate) void checkBrainUpdate();
        void warmShaders(useBrain.getState().gpuWarmShaders);
        if (previousId && previousId !== id) {
          void import("../model-lib").then(async ({ useModelLib }) => {
            const lib = useModelLib.getState();
            const previous = brainModelOf(previousId);
            if (!lib.keepHelperCache && !lib.pinHelper.some((pin) => pin === previousId || pin === previous?.id || pin === previous?.alt)) await invalidateModelCache(previousId);
          }).catch(() => undefined);
        }
        return;
      } catch (err) {
        if (!current()) return;
        if (!attempt && oomish(err) && useBrain.getState().context > 2048) {
          useBrain.getState().setContext(2048);
          onProgress({ progress: 0, text: "GPU-Puffer reicht nicht · gleicher Helfer mit Context 2k" });
          continue;
        }
        if (!attempt && /sliding_window_size|context_window_size/i.test(String(err)) && useBrain.getState().sliding) {
          useBrain.getState().setSliding(false);
          continue;
        }
        throw err;
      }
    }
  }).catch((err) => {
    if (current()) useBrain.getState().setStatus({ status: "error", loadedId: "", progressText: "", error: err instanceof Error ? err.message : String(err) });
  }).finally(() => { if (loading === ticket) loading = null; });
  loadTail = ticket.promise;
  return ticket.promise;
}

export async function interruptBrain(): Promise<void> {
  if (warming) return;
  try {
    await engine?.interruptGenerate?.();
  } catch {
    /* ignore */
  }
}

async function warmShaders(shaders = true): Promise<void> {
  if (!engine) return;
  const loadedEngine = engine;
  warming = true;
  useBrain.getState().setStatus({ progressText: shaders ? "Shader kompilieren…" : "Antwort prüfen…" });
  try {
    const t = await brainGenerate({
      messages: [
        { role: "system", content: "Reply with exactly one word: OK" },
        { role: "user", content: shaders ? `ping ${"token ".repeat(48)}` : "ping" },
      ],
      maxTokens: 8,
      temperature: 0,
      pri: 0,
      job: shaders ? "shader" : "ping",
    });
    if (engine !== loadedEngine) return;
    const ok = t.trim().slice(0, 40);
    useBrain.getState().setLastAuto(ok);
    useBrain.getState().setStatus({
      progressText: worker ? `bereit · GPU-Worker · Shader · ${ok}` : `bereit · GPU · Shader · ${ok}`,
    });
  } catch (err) {
    if (engine !== loadedEngine) return;
    const msg = err instanceof Error ? err.message : "Shader-Warmup fehlgeschlagen";
    useBrain.getState().setStatus({
      status: "error",
      error: `Helfer antwortet nicht: ${msg}`,
      progressText: "",
      loadedId: "",
    });
    await disposeBrainEngine();
  } finally {
    if (engine === loadedEngine) warming = false;
  }
}

async function disposeBrainEngine(): Promise<void> {
  const previous = engine;
  const previousWorker = worker;
  // A worker that no longer replies cannot acknowledge interrupt/unload.
  // Detach it first so cancelled jobs cannot use a subsequently loaded engine.
  engine = null;
  worker = null;
  gpuCache = null;
  warming = false;
  clearTimeout(keepAliveTimer);
  if (typeof window !== "undefined") window.clearTimeout(hideTimer);
  resetBrainQueue();
  if (previousWorker) {
    previousWorker.terminate();
    return;
  }
  if (!previous) return;
  const retired = Promise.resolve().then(() => previous.unload?.()).catch(() => undefined).finally(() => {
    if (retiringMain === retired) retiringMain = null;
  });
  retiringMain = retired;
  await waitForMainRelease(false);
}

async function waitForMainRelease(required = true): Promise<void> {
  if (!retiringMain) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([retiringMain, new Promise<void>((resolve) => { timer = setTimeout(resolve, 1500); })]);
  } finally { clearTimeout(timer); }
  if (required && retiringMain !== null) throw new Error("Die vorherige GPU-Berechnung gibt den Speicher noch nicht frei. Erneut laden, sobald sie beendet ist; bei dauerhaftem Stillstand Anvil neu starten.");

}

export async function unloadBrain(): Promise<void> {
  const sequence = ++loadSequence;
  loading?.ctrl.abort();
  loading?.cancel?.();
  loading = null;
  await disposeBrainEngine();
  if (sequence !== loadSequence) return;
  useBrain.getState().setStatus({ status: "idle", loadedId: "", loadedConfig: "", progress: 0, progressText: "", error: "" });
}

const cacheChecks = new Map<string, { epoch: number; at: number; promise: Promise<boolean> }>();
export async function invalidateModelCache(id: string): Promise<void> {
  const llm = await webllm();
  const record = llm.prebuiltAppConfig.model_list.find((m) => m.model_id === id);
  if (record) await removeModelCache(record);
  cacheChecks.delete(id);
  useBrain.getState().setStatus({ cacheEpoch: useBrain.getState().cacheEpoch + 1 });
}

export async function clearBrainCache(id?: string, opts?: { force?: boolean }): Promise<void> {
  const { useModelLib } = await import("../model-lib");
  if (!opts?.force && useModelLib.getState().keepHelperCache) {
    useBrain.getState().setStatus({ progressText: "Cache bleibt — „Lokal behalten“ an." });
    return;
  }
  const mid = id || useBrain.getState().loadedId || activeModelId();
  if (useBrain.getState().loadedId === mid || loading?.wanted === mid) await unloadBrain();
  await invalidateModelCache(mid);
}

export function modelCached(id: string): Promise<boolean> {
  const epoch = useBrain.getState().cacheEpoch;
  const hit = cacheChecks.get(id);
  if (hit?.epoch === epoch && Date.now() - hit.at < 30_000) return hit.promise;
  const promise = (async () => {
    if (await helperLocalId(id)) return true;
    const llm = await webllm();
    for (const cacheBackend of [...cacheOrder(), "cache"] as CacheBackend[]) {
      for (const local of [false, true]) {
        const model_list = llm.prebuiltAppConfig.model_list.map((m) => local && m.model_id === id ? nativeRecord(m) : m);
        try { if (await llm.hasModelInCache(id, { model_list, cacheBackend })) return true; }
        catch { /* Backend unavailable; also check the others on cache misses. */ }
      }
    }
    return false;
  })().catch(() => false);
  cacheChecks.set(id, { epoch, at: Date.now(), promise });
  return promise;
}

export async function prefetchBrain(id: string, onProgress?: (p: { progress: number; text: string }) => void): Promise<void> {
  const check = captureHelperLocal(id);
  if (nativeHelper()) {
    const ready = await helperLocalId(id, true);
    check();
    if (ready) { onProgress?.({ progress: 1, text: "auf der Festplatte" }); return; }
    await downloadHelperLocal(id, (p) => onProgress?.({ progress: p.total ? p.done / p.total : 0, text: p.rel }));
    return;
  }
  if (await modelCached(id)) { onProgress?.({ progress: 1, text: "schon im Cache" }); return; }
  // WebLLM has no weight-only prefetch API. Serialize its temporary engine with
  // regular loads, and never allocate a second GPU model beside an active one.
  const task = loadTail.then(async () => {
    check();
    if (engine || loading) throw new Error("Zum Vorladen den aktiven Helfer zuerst entladen.");
    await waitForMainRelease();
    const ticket: LoadTicket = { id: loadSequence, wanted: id, ctrl: new AbortController(), promise: Promise.resolve() };
    const loaded = await createEngine(id, (p) => onProgress?.(p), ticket);
    if (loaded.worker) loaded.worker.terminate();
    else await loaded.engine.unload?.();
    cacheChecks.delete(id);
    useBrain.getState().setStatus({ cacheEpoch: useBrain.getState().cacheEpoch + 1 });
  });
  loadTail = task.catch(() => undefined);
  await task;
}

export async function updateBrainModel(id: string, onProgress?: (p: { progress: number; text: string }) => void): Promise<void> {
  const check = captureHelperLocal(id);
  const spec = brainModelOf(id);
  const current = useBrain.getState().loadedId;
  const mid = current && (current === id || current === spec?.alt) ? current : resolveBrainId(id, (await gpuInfo()).fp16);
  check();
  const reload = engine && current === mid;
  if (reload || loading?.wanted === id) await unloadBrain();
  check();
  if (nativeHelper()) await downloadHelperLocal(mid, (p) => onProgress?.({ progress: p.total ? p.done / p.total : 0, text: p.rel }), { update: true });
  else { await invalidateModelCache(mid); check(); await prefetchBrain(mid, onProgress); }
  check();
  if (reload && useBrain.getState().on && (activeModelId() === id || activeModelId() === spec?.id)) await loadBrain(true);
}

export async function deleteBrainModel(id: string): Promise<void> {
  const spec = brainModelOf(id);
  const ids = [...new Set([id, spec?.id, spec?.alt].filter((x): x is string => Boolean(x)))];
  for (const mid of ids) cancelHelperLocal(mid);
  if (ids.includes(useBrain.getState().loadedId) || (loading && ids.includes(loading.wanted))) await unloadBrain();
  for (const mid of ids) {
    await nativeHelper()?.helperDelete(mid);
    await invalidateModelCache(mid);
  }
}

export function checkBrainUpdate(): Promise<string> {
  if (updatePromise) return updatePromise;
  const st = useBrain.getState();
  const id = st.loadedId || activeModelId();
  const valid = () => (useBrain.getState().loadedId || activeModelId()) === id;
  st.setStatus({ checkingUpdate: true });
  updatePromise = (async () => {
    const llm = await webllm();
    const record = llm.prebuiltAppConfig.model_list.find((m) => m.model_id === id);
    const repo = record?.model.match(/^https:\/\/huggingface\.co\/([^/]+\/[^/]+)/)?.[1];
    let stamp = "";
    if (repo) {
      try {
        const response = await fetch(`https://huggingface.co/api/models/${repo}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (response.ok) { const j = await response.json(); stamp = String(j.sha || j.lastModified || ""); }
      } catch { /* report offline without changing engine readiness */ }
    }
    const prev = useBrain.getState().modelStamps[id];
    const hint = st.libVersion && st.libVersion !== llm.modelVersion ? `WebLLM-Runtime neu (${llm.modelVersion}). Modell neu laden.`
      : prev && stamp && prev !== stamp ? "Neue Modellrevision verfügbar. Unter Modelle aktualisieren."
      : stamp ? "Online-Revision geprüft. Aktualisieren lädt und prüft die Modelldateien." : "Online-Revision nicht erreichbar; lokaler Helfer bleibt verfügbar.";
    if (valid()) st.setStatus({ libVersion: llm.modelVersion, modelStamps: { ...useBrain.getState().modelStamps, ...(stamp ? { [id]: stamp } : {}) }, updateHint: hint });
    return hint;
  })().catch((err) => {
    const hint = err instanceof Error ? err.message : "Update-Check fehlgeschlagen";
    if (valid()) st.setStatus({ updateHint: hint });
    return hint;
  }).finally(() => { useBrain.getState().setStatus({ checkingUpdate: false }); updatePromise = null; });
  return updatePromise;
}

export async function listRuntimeModels(): Promise<string[]> {
  const llm = await webllm();
  return (llm.prebuiltAppConfig.model_list ?? []).map((m: { model_id: string }) => m.model_id);
}

export async function brainGenerate(opts: {
  messages: ChatMsg[]; maxTokens?: number; temperature?: number; stop?: string[];
  json?: boolean; pri?: BrainPri; job?: string; onDelta?: (s: string) => void;
  deadlineMs?: number; signal?: AbortSignal; automatic?: boolean;
}): Promise<string> {
  if (!brainReady() || !engine) throw new Error("Helfer nicht geladen");
  const loadedEngine = engine;
  const st = useBrain.getState();
  const job = opts.job ?? "gen";
  const diagnostic = ["warm", "shader", "ping"].includes(job);
  const valid = diagnostic ? () => useBrain.getState().on : captureBrainScope(job, opts.automatic);
  if (!valid()) throw brainCanceled();
  const maxTokens = opts.maxTokens ?? st.maxTokens;
  const payload: Record<string, unknown> = {
    messages: opts.messages, temperature: opts.temperature ?? st.temperature,
    max_tokens: maxTokens, top_p: 0.9, repetition_penalty: st.repeatPenalty, stream: Boolean(opts.onDelta),
  };
  // Qwen3/3.5 templates support WebLLM's empty thinking header. Other model
  // families retain their own conversation template.
  if (/^Qwen3(?:[.-]|$)/i.test(st.loadedId)) payload.extra_body = { enable_thinking: false };
  if (opts.stop?.length) payload.stop = opts.stop;
  if (opts.json) payload.response_format = { type: "json_object" };
  const key = cacheKey([job, String(session), st.loadedId, JSON.stringify(payload)]);
  if (!opts.onDelta && !diagnostic) {
    const hit = cacheGet(key);
    if (hit != null) return hit;
  }
  const ctrl = new AbortController();
  const cancel = () => ctrl.abort(opts.signal?.reason ?? brainCanceled());
  const checkScope = () => { if (!valid()) cancel(); };
  const offIde = diagnostic ? () => {} : useIde.subscribe(checkScope);
  const offBrain = useBrain.subscribe(checkScope);
  opts.signal?.addEventListener("abort", cancel, { once: true });
  if (opts.signal?.aborted) cancel();
  let started = false;
  let settled = false;
  let settle: () => void = () => {};
  const finished = new Promise<void>((resolve) => { settle = resolve; });
  const startTime = Date.now();
  return enqueueBrain(opts.pri ?? 1, job, async (signal) => {
    started = true;
    lastUse = Date.now();
    const check = () => {
      signal.throwIfAborted();
      if (engine !== loadedEngine || !valid()) throw brainCanceled();
    };
    const interrupt = () => {
      try { void Promise.resolve(loadedEngine.interruptGenerate?.()).catch(() => undefined); } catch { /* lost worker */ }
    };
    signal.addEventListener("abort", interrupt, { once: true });
    try {
      check();
      const raw = await loadedEngine.chat.completions.create(payload);
      check();
      let text = "";
      let emitted = "";
      const emit = () => {
        const clean = helperText(text).replace(/<[^>]*$/, "").trimEnd();
        if (clean.startsWith(emitted) && clean.length > emitted.length) {
          opts.onDelta?.(clean.slice(emitted.length));
          emitted = clean;
        }
      };
      if (opts.onDelta && raw && typeof raw === "object" && Symbol.asyncIterator in raw) {
        for await (const chunk of raw as AsyncIterable<{ choices?: { delta?: { content?: string } }[] }>) {
          check();
          text += chunk.choices?.[0]?.delta?.content ?? "";
          emit();
        }
      } else {
        text = (raw as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ?? "";
      }
      check();
      const out = helperText(String(text));
      if (!out) throw new Error("Helfer lieferte keine nutzbare Antwort");
      if (opts.json && extractJson(out) === null) throw new Error("Helfer lieferte kein gültiges JSON");
      emit();
      if (!opts.onDelta && !diagnostic) cacheSet(key, out);
      return out;
    } finally {
      signal.removeEventListener("abort", interrupt);
      settled = true;
      settle();
    }
  }, { maxTokens, deadlineMs: opts.deadlineMs, signal: ctrl.signal }).catch(async (error) => {
    const name = error instanceof Error ? error.name : "";
    const timeout = /Timeout/.test(name);
    const canceled = ctrl.signal.aborted || /Abort|Superseded|Unavailable/.test(name) || /pausiert|entladen|cleared/.test(String(error));
    useBrain.getState().logJob(job, timeout ? "timeout" : canceled ? "cancel" : "error", Date.now() - startTime, error instanceof Error ? error.message : String(error));
    if (started && !settled && engine === loadedEngine) {
      // A normal interrupt may take a few GPU frames. Keep the queue quarantined
      // during this grace period; detach only if the generation never settles.
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([finished, new Promise<void>((resolve) => { timer = setTimeout(resolve, 1500); })]);
      clearTimeout(timer);
      if (!settled && engine === loadedEngine) {
        useBrain.getState().setStatus({ status: "error", loadedId: "", error: "Helfer reagiert nicht auf Abbruch. Unter Einstellungen erneut laden." });
        await disposeBrainEngine();
      }
    }
    if (engine === loadedEngine && /device lost|out of memory|oom/i.test(String(error))) {
      useBrain.getState().setStatus({ status: "error", loadedId: "", error: String(error) });
      await disposeBrainEngine();
    }
    throw error;
  }).finally(() => {
    offIde(); offBrain();
    opts.signal?.removeEventListener("abort", cancel);
  });
}

export function brainSystem(task: string): string {
  const extra = useBrain.getState().systemExtra.trim();
  const base = `You are Anvil's local helper, not the main thinker. ONLY this task: ${task}
Rules: no essays, no greeting, no apology, no invented files, no secrets.
Short output may be a note to the main model — never pretend you are the agent.
If unsure: the specified fallback format, invent nothing.
User-visible phrases (chips, titles, follow-ups) in ${useIde.getState().locale === "en" ? "English" : "German"}. JSON keys in English. Code and planning belong to the main model.`;
  return extra ? `${base}\n${extra}` : base;
}

export function extractJson(raw: string): unknown | null {
  const t = helperText(raw);
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence?.[1] ?? t;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function firstUsefulLine(raw: string, max = 80): string {
  const line = helperText(raw)
    .replace(/^```[\w]*\n?|\n?```$/g, "")
    .split("\n")
    .map((l) => l.trimEnd())
    .find((l) => l.trim() && !/^(hier|sure|okay|gut,|natürlich|als ki)/i.test(l));
  return (line ?? "").slice(0, max);
}
