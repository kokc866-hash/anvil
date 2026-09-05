import { cacheGet, cacheKey, cacheSet, resetBrainQueue, enqueueBrain, type BrainPri } from "./queue";
import { activeModelId, brainReady, useBrain } from "./store";
import { BRAIN_MODELS, brainModelOf, resolveBrainId } from "./models";
import { cacheOrder } from "../model-lib";
import { downloadHelperLocal, helperLocalId, helperLocalUrls, nativeHelper, syncHelperAuth } from "../helper-local";

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

async function webllm() {
  return import("@mlc-ai/web-llm");
}

function bindVisibility() {
  if (visBound || typeof document === "undefined") return;
  visBound = true;
  document.addEventListener("visibilitychange", () => {
    window.clearTimeout(hideTimer);
    if (!document.hidden) return;
    hideTimer = window.setTimeout(() => {
      if (document.hidden && !warming) void engine?.interruptGenerate?.();
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
  if (gpuCache && Date.now() - gpuCache.t < 20_000) return gpuCache.v;
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

function chatOpts() {
  const st = useBrain.getState();
  const spec = brainModelOf(activeModelId());
  const want = Math.min(st.context || 8192, spec?.ctx ?? 32768);
  const ctx = fitContext(want, gpuCache?.v.maxBuffer ?? 0, spec?.vramMb ?? 1000);
  const hist = 8;
  if (st.sliding) {
    return {
      context_window_size: -1,
      sliding_window_size: ctx,
      attention_sink_size: 4,
      max_history_size: hist,
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
    max_history_size: hist,
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

async function createEngine(id: string, onProgress: (p: { progress: number; text: string }) => void): Promise<Engine> {
  const llm = await webllm();
  const st = useBrain.getState();
  await gpuInfo();
  const opts = chatOpts();
  const folder = await helperLocalId(id);
  let local = Boolean(folder);
  const native = nativeHelper();
  if (!local && native) {
    onProgress({ progress: 0, text: "Auf die Festplatte…" });
    try {
      await downloadHelperLocal(id, (p) =>
        onProgress({ progress: p.total ? p.done / p.total : 0, text: `${p.rel} (${p.done}/${p.total})` }),
      );
    } catch (err) {
      onProgress({
        progress: 0,
        text: `Direkt laden (${err instanceof Error ? err.message : "Download"})…`,
      });
    }
    local = true;
  }
  await syncHelperAuth();
  const backends = local ? cacheOrder().slice(0, 1) : cacheOrder();
  let last: unknown;
  for (const backend of backends) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      onProgress({
        progress: 0,
        text: local ? "Von der Festplatte…" : attempt > 1 ? `Download nochmal (${backend})…` : `Erst-Download · ${backend}`,
      });
      try {
        const model_list = llm.prebuiltAppConfig.model_list.map((m: { model_id: string; model: string; model_lib: string }) => {
          if (!local || m.model_id !== id) return m;
          const u = helperLocalUrls(id, m.model_lib);
          return { ...m, model: u.model, model_lib: u.model_lib };
        });
        const cfg = {
          initProgressCallback: onProgress,
          logLevel: "ERROR" as const,
          appConfig: { model_list, cacheBackend: backend },
        };
        if (st.useWorker && typeof Worker !== "undefined") {
          try {
            worker?.terminate();
            worker = new Worker(new URL("./gpu-worker.ts", import.meta.url), { type: "module" });
            return (await llm.CreateWebWorkerMLCEngine(worker, id, cfg, opts)) as unknown as Engine;
          } catch (err) {
            worker?.terminate();
            worker = null;
            last = err;
          }
        }
        return (await llm.CreateMLCEngine(id, cfg, opts)) as unknown as Engine;
      } catch (err) {
        last = err;
        if (!netish(err) && !/Cache\.add/i.test(String(err))) throw err;
        await new Promise((r) => setTimeout(r, 600 * attempt));
      }
    }
  }
  throw last instanceof Error ? last : new Error(String(last ?? "Download fehlgeschlagen"));
}

export async function loadBrain(force = false): Promise<void> {
  const st = useBrain.getState();
  if (!st.on) return;
  const wanted = activeModelId();
  if (!force && engine && st.loadedId && (st.loadedId === wanted || st.loadedId.includes(wanted))) return;
  bindVisibility();
  const gpu = await gpuInfo();
  st.setStatus({ gpu: gpu.info, fp16: gpu.fp16 });
  if (!gpu.ok) {
    st.setStatus({ status: "error", error: gpu.info, progressText: "" });
    return;
  }
  let spec = brainModelOf(wanted);
  let id = spec ? resolveBrainId(wanted, gpu.fp16) : wanted;
  st.setStatus({ status: "downloading", error: "", progress: 0, progressText: "WebGPU / Modell…" });
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* quota */
  }
  const onProgress = (p: { progress: number; text: string }) => {
    useBrain.getState().setStatus({
      status: "downloading",
      progress: p.progress ?? 0,
      progressText: p.text || "Download…",
    });
  };
  try {
    await disposeBrainEngine();
    engine = await createEngine(id, onProgress);
    const loadedEngine = engine;
    engine.setLogLevel?.("ERROR");
    const prev = useBrain.getState().loadedId;
    useBrain.getState().setStatus({
      status: "ready",
      loadedId: id,
      libVersion: (await webllm()).modelVersion,
      progress: 1,
      progressText: worker ? "bereit · GPU-Worker" : "bereit · GPU",
      error: "",
    });
    if (prev && prev !== id) {
      const { useModelLib } = await import("../model-lib");
      const lib = useModelLib.getState();
      if (!lib.keepHelperCache && !lib.pinHelper.includes(prev)) {
        void clearBrainCache(prev, { force: true });
      }
    }
    if (st.autoUpdate) void checkBrainUpdate();
    if (useBrain.getState().gpuWarmShaders) void warmShaders();
    else {
    void brainGenerate({
      messages: [
        { role: "system", content: "Reply with exactly one word: OK" },
        { role: "user", content: "ping" },
      ],
      maxTokens: 8,
      temperature: 0,
      pri: 0,
      job: "ping",
    })
      .then((t) => {
        if (engine !== loadedEngine) return;
        const ok = (t.trim() || "ok").slice(0, 40);
        useBrain.getState().setLastAuto(ok);
        useBrain.getState().setStatus({ progressText: `antwortet · ${ok}` });
      })
      .catch((err) => {
        if (engine !== loadedEngine) return;
        const msg = err instanceof Error ? err.message : "keine Antwort";
        useBrain.getState().setStatus({
          status: "error",
          error: `Helfer antwortet nicht: ${msg}`,
          progressText: "",
          loadedId: "",
        });
      });
    }
  } catch (err) {
    engine = null;
    worker?.terminate();
    worker = null;
    if (oomish(err) && useBrain.getState().context > 2048) {
      useBrain.getState().setContext(2048);
      useBrain.getState().setStatus({ progressText: "OOM — Context 2k, gleicher Helfer nochmal" });
      return loadBrain(true);
    }
    if (oomish(err)) {
      useBrain.getState().setStatus({
        status: "error",
        error: `${brainModelOf(id)?.label ?? id} passt nicht in den GPU-Puffer. Kleineres Helfer-Modell wählen oder Context senken — es wird nicht still getauscht.`,
        progressText: "",
        loadedId: "",
      });
      return;
    }
    const raw = err instanceof Error ? err.message : String(err);
    const net = /Cache\.add|network error|Failed to fetch|ERR_NETWORK|QUIC/i.test(raw);
    const slide = /sliding_window_size|context_window_size/i.test(raw);
    if (slide && useBrain.getState().sliding) {
      useBrain.getState().setSliding(false);
      useBrain.getState().setStatus({ progressText: "Sliding aus — neuer Versuch" });
      return loadBrain(true);
    }
    useBrain.getState().setStatus({
      status: "error",
      error: net
        ? "Download abgebrochen (HuggingFace/Cache). Helfer: SmolLM 360M oder Qwen 0.5–1.7B. 4B ist ~4 GB und oft unnötig — Agent ist Ollama. Cache löschen, nochmal laden."
        : raw,
      progressText: "",
      loadedId: "",
    });
  }
}

export async function interruptBrain(): Promise<void> {
  if (warming) return;
  try {
    await engine?.interruptGenerate?.();
  } catch {
    /* ignore */
  }
}

async function warmShaders(): Promise<void> {
  if (!engine) return;
  const loadedEngine = engine;
  warming = true;
  useBrain.getState().setStatus({ progressText: "Shader kompilieren…" });
  try {
    const t = await brainGenerate({
      messages: [
        { role: "system", content: "Reply with exactly one word: OK" },
        { role: "user", content: `ping ${"token ".repeat(48)}` },
      ],
      maxTokens: 8,
      temperature: 0,
      pri: 0,
      job: "shader",
    });
    if (engine !== loadedEngine) return;
    const ok = (t.trim() || "ok").slice(0, 40);
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
  resetBrainQueue();
  if (previousWorker) {
    previousWorker.terminate();
    return;
  }
  if (!previous) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(() => previous.unload?.()),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, 1500); }),
    ]);
  } catch {
    /* a lost GPU device may reject unload */
  } finally {
    clearTimeout(timer);
  }
}

export async function unloadBrain(): Promise<void> {
  await disposeBrainEngine();
  useBrain.getState().setStatus({ status: "idle", loadedId: "", progress: 0, progressText: "", error: "" });
}

export async function clearBrainCache(id?: string, opts?: { force?: boolean }): Promise<void> {
  const { useModelLib } = await import("../model-lib");
  if (!opts?.force && useModelLib.getState().keepHelperCache) {
    useBrain.getState().setStatus({ progressText: "Cache bleibt — „Lokal behalten“ an. Zum Löschen den Schalter aus oder Cache löschen bestätigen." });
    return;
  }
  const llm = await webllm();
  const mid = id || useBrain.getState().loadedId || activeModelId();
  await llm.deleteModelAllInfoInCache(mid);
  if (useBrain.getState().loadedId === mid) await unloadBrain();
}

export async function modelCached(id: string): Promise<boolean> {
  try {
    const llm = await webllm();
    return await llm.hasModelInCache(id, { ...llm.prebuiltAppConfig, cacheBackend: cacheOrder()[0] });
  } catch {
    try {
      const llm = await webllm();
      return await llm.hasModelInCache(id);
    } catch {
      return false;
    }
  }
}

export async function prefetchBrain(id: string, onProgress?: (p: { progress: number; text: string }) => void): Promise<void> {
  const gpu = await gpuInfo();
  if (!gpu.ok) throw new Error(gpu.info);
  const llm = await webllm();
  if (await modelCached(id)) {
    onProgress?.({ progress: 1, text: "schon im Cache" });
    return;
  }
  const backends = cacheOrder();
  let last: unknown;
  for (const backend of backends) {
    try {
      const cfg = {
        initProgressCallback: (p: { progress: number; text: string }) => onProgress?.(p),
        logLevel: "WARN" as const,
        appConfig: { ...llm.prebuiltAppConfig, cacheBackend: backend },
      };
      const eng = (await llm.CreateMLCEngine(id, cfg, chatOpts())) as unknown as Engine;
      await eng.unload?.().catch(() => undefined);
      onProgress?.({ progress: 1, text: `Cache · ${backend}` });
      return;
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error(String(last ?? "Prefetch fehlgeschlagen"));
}

export async function checkBrainUpdate(): Promise<string> {
  const st = useBrain.getState();
  st.setStatus({ status: st.status === "ready" ? "ready" : "checking" });
  try {
    const llm = await webllm();
    const ver = llm.modelVersion;
    const id = st.loadedId || activeModelId();
    let stamp = "";
    try {
      const r = await fetch(`https://huggingface.co/api/models/mlc-ai/${id}`, { cache: "no-store" });
      if (r.ok) {
        const j = (await r.json()) as { lastModified?: string };
        stamp = j.lastModified ?? "";
      }
    } catch {
      /* offline */
    }
    let hint = "";
    if (st.libVersion && st.libVersion !== ver) hint = `WebLLM-Runtime neu (${ver}). Modell neu laden.`;
    else if (st.modelStamp && stamp && stamp !== st.modelStamp) hint = "Modell-Gewichte aktualisiert. Neu laden.";
    else hint = stamp ? "Aktuell" : "Update-Check: Runtime ok";
    st.setStatus({ libVersion: ver, modelStamp: stamp || st.modelStamp, updateHint: hint });
    return hint;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Update-Check fehlgeschlagen";
    st.setStatus({ updateHint: msg });
    return msg;
  }
}

export async function listRuntimeModels(): Promise<string[]> {
  const llm = await webllm();
  return (llm.prebuiltAppConfig.model_list ?? []).map((m: { model_id: string }) => m.model_id);
}

export async function brainGenerate(opts: {
  messages: ChatMsg[];
  maxTokens?: number;
  temperature?: number;
  stop?: string[];
  json?: boolean;
  pri?: BrainPri;
  job?: string;
  onDelta?: (s: string) => void;
}): Promise<string> {
  if (!brainReady() || !engine) throw new Error("Helfer nicht geladen");
  const loadedEngine = engine;
  const st = useBrain.getState();
  const job = opts.job ?? "gen";
  if (!opts.onDelta) {
    const hit = cacheGet(cacheKey([job, JSON.stringify(opts.messages), String(opts.maxTokens ?? 0)]));
    if (hit != null) return hit;
  }
  return enqueueBrain(opts.pri ?? 1, job, async (signal) => {
    const check = () => {
      signal.throwIfAborted();
      if (engine !== loadedEngine) throw new Error("Helfer entladen");
    };
    const interrupt = () => {
      try { void Promise.resolve(loadedEngine.interruptGenerate?.()).catch(() => undefined); } catch { /* lost worker */ }
    };
    check();
    signal.addEventListener("abort", interrupt, { once: true });
    try {
      const payload: Record<string, unknown> = {
        messages: opts.messages,
        temperature: opts.temperature ?? st.temperature,
        max_tokens: opts.maxTokens ?? st.maxTokens,
        top_p: 0.9,
        repetition_penalty: st.repeatPenalty,
        stream: Boolean(opts.onDelta),
      };
      if (opts.stop?.length) payload.stop = opts.stop;
      if (opts.json) payload.response_format = { type: "json_object" };
      const once = async () => {
        check();
        const raw = await loadedEngine.chat.completions.create(payload);
        check();
        let text = "";
        if (opts.onDelta && raw && typeof raw === "object" && Symbol.asyncIterator in (raw as object)) {
          for await (const chunk of raw as AsyncIterable<{ choices?: { delta?: { content?: string } }[] }>) {
            check();
            const t = chunk.choices?.[0]?.delta?.content ?? "";
            if (t) {
              text += t;
              opts.onDelta(t);
            }
          }
        } else {
          const choice = raw as { choices?: { message?: { content?: string } }[] };
          text = choice.choices?.[0]?.message?.content ?? "";
          if (opts.onDelta && text) opts.onDelta(text);
        }
        return String(text).trim();
      };
      let out = "";
      try {
        out = await once();
      } catch (err) {
        check();
        const m = err instanceof Error ? err.message : String(err);
        if (/device lost/i.test(m) && useBrain.getState().status === "ready") {
          gpuCache = null;
          void loadBrain(true);
          throw err;
        }
        if (!/abort|device lost|timeout|oom|interrupted/i.test(m)) throw err;
        await new Promise((r) => setTimeout(r, 500));
        out = await once();
      }
      check();
      if (!opts.onDelta && job !== "warm" && job !== "shader" && job !== "ping") cacheSet(cacheKey([job, JSON.stringify(opts.messages), String(opts.maxTokens ?? 0)]), out);
      return out;
    } finally {
      signal.removeEventListener("abort", interrupt);
    }
  });
}

export function brainSystem(task: string): string {
  const extra = useBrain.getState().systemExtra.trim();
  const base = `You are Anvil's local helper, not the main thinker. ONLY this task: ${task}
Rules: no essays, no greeting, no apology, no invented files, no secrets.
Short output may be a note to the main model — never pretend you are the agent.
If unsure: the specified fallback format, invent nothing.
User-visible phrases (chips, titles, follow-ups) in German. JSON keys in English. Code and planning belong to the main model.`;
  return extra ? `${base}\n${extra}` : base;
}

export function extractJson(raw: string): unknown | null {
  const t = raw.trim();
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
  const line = raw
    .replace(/^```[\w]*\n?|\n?```$/g, "")
    .split("\n")
    .map((l) => l.trimEnd())
    .find((l) => l.trim() && !/^(hier|sure|okay|gut,|natürlich|als ki)/i.test(l));
  return (line ?? "").slice(0, max);
}
