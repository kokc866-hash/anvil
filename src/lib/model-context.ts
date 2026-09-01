export type CtxSource = "katalog" | "api" | "web" | "helfer";

export type CtxHit = { n: number; source: CtxSource };

const cache = new Map<string, CtxHit>();

/** Längere Keys zuerst. Werte = offizielles Kontextfenster. Anvil klemmt auf 256k. */
const TABLE: [string, number][] = [
  ["gpt-4.1", 1_047_576],
  ["gpt-4-turbo", 128_000],
  ["gpt-4o-mini", 128_000],
  ["gpt-4o", 128_000],
  ["gpt-5.4", 256_000],
  ["gpt-5.2", 256_000],
  ["gpt-5", 256_000],
  ["o4-mini", 200_000],
  ["o3-mini", 200_000],
  ["o1-mini", 128_000],
  ["o3", 200_000],
  ["o1", 200_000],
  ["claude-opus-4", 200_000],
  ["claude-sonnet-4", 200_000],
  ["claude-3-7", 200_000],
  ["claude-3-5", 200_000],
  ["claude-3-opus", 200_000],
  ["claude-3-sonnet", 200_000],
  ["claude-3-haiku", 200_000],
  ["claude-opus", 200_000],
  ["claude-sonnet", 200_000],
  ["claude-haiku", 200_000],
  ["gemini-2.5-pro", 1_048_576],
  ["gemini-2.5-flash", 1_048_576],
  ["gemini-2.0-flash", 1_048_576],
  ["gemini-1.5-pro", 2_097_152],
  ["gemini-1.5-flash", 1_048_576],
  ["gemini-pro", 32_768],
  ["grok-4", 256_000],
  ["grok-3", 131_072],
  ["grok-2", 131_072],
  ["grok-beta", 131_072],
  ["llama-3.1-405b", 131_072],
  ["llama-3.1-70b", 131_072],
  ["llama-3.1-8b", 131_072],
  ["llama-3.2", 131_072],
  ["llama-3.3", 131_072],
  ["llama3.1", 131_072],
  ["llama3.2", 131_072],
  ["qwen2.5-72b", 32_768],
  ["qwen2.5-coder", 32_768],
  ["qwen2.5", 32_768],
  ["qwen3", 40_960],
  ["mistral-large", 128_000],
  ["mistral-small", 128_000],
  ["codestral", 256_000],
  ["deepseek-chat", 64_000],
  ["deepseek-reasoner", 64_000],
  ["deepseek-coder", 128_000],
  ["command-r-plus", 128_000],
  ["command-r", 128_000],
  ["sonar-pro", 200_000],
  ["sonar", 127_000],
];

function keyOf(model: string): string {
  return model.trim().toLowerCase().replace(/^models\//, "");
}

export function lookupKnown(model: string): CtxHit | null {
  const k = keyOf(model);
  const cached = cache.get(k) || cache.get(k.split("/").pop() || k);
  if (cached) return cached;
  const tail = k.split("/").pop() || k;
  for (const [id, n] of TABLE) {
    if (k === id || tail === id || k.includes(id) || tail.startsWith(id)) {
      const hit: CtxHit = { n, source: "katalog" };
      cache.set(k, hit);
      return hit;
    }
  }
  return null;
}

export function rememberContext(model: string, n: number, source: CtxSource): CtxHit | null {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 2048) return null;
  const hit: CtxHit = { n: Math.round(x), source };
  const k = keyOf(model);
  cache.set(k, hit);
  const tail = k.split("/").pop();
  if (tail && tail !== k) cache.set(tail, hit);
  return hit;
}

export function ingestModelRow(row: Record<string, unknown>): void {
  const id = String(row.id ?? row.name ?? "");
  if (!id) return;
  const n =
    num(row.context_length) ||
    num(row.max_model_len) ||
    num(row.context_window) ||
    num(row.max_tokens) ||
    num((row.limit as { context?: unknown } | undefined)?.context) ||
    num((row.meta as { n_ctx_train?: unknown } | undefined)?.n_ctx_train);
  if (n) rememberContext(id, n, "api");
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 2048 ? n : 0;
}

const CONTEXT_MAX = 262_144;
const CONTEXT_MIN = 2048;

const LOCAL = new Set([
  "ollama",
  "lmstudio",
  "llamacpp",
  "vllm",
  "localai",
  "jan",
  "gpt4all",
  "koboldcpp",
  "textgen",
  "openwebui",
  "brain",
]);

export function wantsAutoContext(provider: string): boolean {
  return !LOCAL.has(provider);
}

export function anvilContext(n: number): number {
  const x = Math.round(Number(n) || 32768);
  return Math.min(CONTEXT_MAX, Math.max(CONTEXT_MIN, x));
}

export function ctxLabel(hit: CtxHit): string {
  const k = hit.n >= 1024 ? `${Math.round(hit.n / 1024)}k` : String(hit.n);
  const src = hit.source === "katalog" ? "Katalog" : hit.source === "api" ? "API" : hit.source === "web" ? "Web" : "Helfer";
  const cap = hit.n > CONTEXT_MAX ? ` · Anvil max ${CONTEXT_MAX / 1024}k` : "";
  return `${k} (${src})${cap}`;
}

let remote: Promise<void> | null = null;

async function loadRemoteCatalog(): Promise<void> {
  if (remote) return remote;
  remote = (async () => {
    try {
      const { fetchWeb } = await import("./web-fetch");
      const r = await fetchWeb({ data: { url: "https://openrouter.ai/api/v1/models" } });
      if (!r.ok) return;
      const j = JSON.parse(r.text) as { data?: Record<string, unknown>[] };
      for (const row of j.data ?? []) ingestModelRow({ ...row, context_length: row.context_length });
    } catch {
      remote = null;
    }
  })();
  return remote;
}

async function helperGuess(model: string, blob: string): Promise<CtxHit | null> {
  try {
    const { brainReady } = await import("./brain/store");
    if (!brainReady()) return null;
    const { brainGenerate, brainSystem } = await import("./brain/engine");
    const raw = await brainGenerate({
      messages: [
        {
          role: "system",
          content: brainSystem("One number only: context window in tokens. Else 0. No prose."),
        },
        { role: "user", content: `Modell ${model}\n${blob.slice(0, 1200)}` },
      ],
      maxTokens: 12,
      temperature: 0,
      stop: ["\n"],
      pri: 2,
      job: "help",
    });
    const m = raw.match(/(\d[\d_]{3,})/);
    if (!m) return null;
    return rememberContext(model, Number(m[1].replace(/_/g, "")), "helfer");
  } catch {
    return null;
  }
}

export async function resolveModelContext(model: string, provider: string): Promise<CtxHit | null> {
  if (!model.trim() || !wantsAutoContext(provider)) return lookupKnown(model);
  const known = lookupKnown(model);
  if (known) return known;
  await loadRemoteCatalog();
  const after = lookupKnown(model);
  if (after) return { ...after, source: after.source === "katalog" ? "katalog" : "web" };
  try {
    const { fetchWeb } = await import("./web-fetch");
    const q = encodeURIComponent(`${model} context window tokens`);
    const r = await fetchWeb({ data: { url: `https://openrouter.ai/api/v1/models` } });
    if (r.ok) {
      const guessed = await helperGuess(model, r.text);
      if (guessed) return guessed;
    }
    void q;
  } catch {
    /* */
  }
  return lookupKnown(model);
}

export async function applyCloudContext(): Promise<string | null> {
  const { useIde } = await import("@/store/ide");
  const st = useIde.getState();
  if (!st.llmContextAuto) return null;
  if (!wantsAutoContext(st.llmProvider)) return null;
  const hit = await resolveModelContext(st.llmModel, st.llmProvider);
  if (!hit) return null;
  const n = anvilContext(hit.n);
  if (n === st.llmContext) return ctxLabel(hit);
  st.setLlmContext(n);
  return ctxLabel(hit);
}