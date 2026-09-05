import { CONTEXT_MAX, CONTEXT_MIN, formatContext } from "./tokens.ts";

export type CtxSource = "katalog" | "api" | "web" | "helfer";

export type CtxHit = { n: number; source: CtxSource };

const cache = new Map<string, CtxHit>();

/** Längere Keys zuerst (gpt-5.5 vor gpt-5). Nur exakt oder `id-…`, kein includes. */
const TABLE: [string, number][] = [
  ["gpt-6-astra-pro", 1_050_000],
  ["gpt-6-astra", 1_050_000],
  ["gpt-6", 1_050_000],
  ["gpt-5.6-luna", 1_048_576],
  ["gpt-5.6-terra", 1_048_576],
  ["gpt-5.6-sol", 1_048_576],
  ["gpt-5.6", 1_048_576],
  ["gpt-5.5-pro", 1_048_576],
  ["gpt-5.5", 1_048_576],
  ["gpt-5.4", 1_048_576],
  ["gpt-5.2", 256_000],
  ["gpt-5", 256_000],
  ["gpt-4.1", 1_047_576],
  ["gpt-4-turbo", 128_000],
  ["gpt-4o-mini", 128_000],
  ["gpt-4o", 128_000],
  ["o4-mini", 200_000],
  ["o3-mini", 200_000],
  ["o1-mini", 128_000],
  ["o3", 200_000],
  ["o1", 200_000],
  ["claude-fable-5.1", 1_000_000],
  ["claude-fable-5", 1_000_000],
  ["claude-fable", 1_000_000],
  ["claude-opus-5", 1_000_000],
  ["claude-opus-4-8", 1_000_000],
  ["claude-opus-4.8", 1_000_000],
  ["claude-opus-4-7", 1_000_000],
  ["claude-opus-4-6", 1_000_000],
  ["claude-opus-4-5", 200_000],
  ["claude-opus-4-1", 200_000],
  ["claude-opus-4", 200_000],
  ["claude-sonnet-5", 1_000_000],
  ["claude-sonnet-4-6", 1_000_000],
  ["claude-sonnet-4-5", 200_000],
  ["claude-sonnet-4", 200_000],
  ["claude-haiku-4-5", 200_000],
  ["claude-haiku-4.5", 200_000],
  ["claude-3-7", 200_000],
  ["claude-3-5", 200_000],
  ["claude-3-opus", 200_000],
  ["claude-3-sonnet", 200_000],
  ["claude-3-haiku", 200_000],
  ["claude-opus", 200_000],
  ["claude-sonnet", 200_000],
  ["claude-haiku", 200_000],
  ["gemini-3.8", 1_048_576],
  ["gemini-3.5", 1_048_576],
  ["gemini-3.1", 1_048_576],
  ["gemini-3", 1_048_576],
  ["gemini-2.5-pro", 1_048_576],
  ["gemini-2.5-flash", 1_048_576],
  ["gemini-2.0-flash", 1_048_576],
  ["gemini-1.5-pro", 2_097_152],
  ["gemini-1.5-flash", 1_048_576],
  ["gemini-pro", 32_768],
  ["grok-4.5", 500_000],
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

const RANKED = [...TABLE].sort((a, b) => b[0].length - a[0].length);

export function modelKey(model: string): string {
  return String(model || "")
    .trim()
    .toLowerCase()
    .replace(/^models\//, "")
    .replace(/:latest$/, "");
}

/** `gpt-5` darf `gpt-5.5-pro` nicht treffen — nur gleich oder `id-suffix`. */
export function modelMatchesId(model: string, id: string): boolean {
  const needle = String(id || "").toLowerCase();
  if (!needle) return false;
  const k = modelKey(model);
  const tail = k.split("/").pop() || k;
  for (const hay of [k, tail]) {
    if (hay === needle) return true;
    if (hay.startsWith(`${needle}-`)) return true;
  }
  return false;
}

function keyOf(model: string): string {
  return modelKey(model);
}

function guessFromName(model: string): number {
  const tail = modelKey(model).split("/").pop() || "";
  const m = tail.match(/(?:^|[-_])(\d{4,8})$/);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= CONTEXT_MIN && n <= CONTEXT_MAX ? n : 0;
}

export function lookupKnown(model: string): CtxHit | null {
  const k = keyOf(model);
  if (!k) return null;
  const cached = cache.get(k) || cache.get(k.split("/").pop() || k);
  if (cached) return cached;
  for (const [id, n] of RANKED) {
    if (modelMatchesId(k, id)) {
      const hit: CtxHit = { n, source: "katalog" };
      cache.set(k, hit);
      return hit;
    }
  }
  const named = guessFromName(k);
  if (named) {
    const hit: CtxHit = { n: named, source: "katalog" };
    cache.set(k, hit);
    return hit;
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
  const arch = row.architecture as { n_ctx?: unknown } | undefined;
  const n =
    num(row.context_length) ||
    num(row.context_window) ||
    num(row.max_model_len) ||
    num(row.max_input_tokens) ||
    num((row.limit as { context?: unknown } | undefined)?.context) ||
    num((row.meta as { n_ctx_train?: unknown } | undefined)?.n_ctx_train) ||
    num(arch?.n_ctx);
  if (n) rememberContext(id, n, "api");
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 2048 ? n : 0;
}

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
  const src = hit.source === "katalog" ? "Katalog" : hit.source === "api" ? "API" : hit.source === "web" ? "Web" : "Helfer";
  const cap = hit.n > CONTEXT_MAX ? ` · Anvil max ${formatContext(CONTEXT_MAX)}` : "";
  return `${formatContext(hit.n)} (${src})${cap}`;
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
      for (const row of j.data ?? []) ingestModelRow(row);
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
    const r = await fetchWeb({ data: { url: "https://openrouter.ai/api/v1/models" } });
    if (r.ok) {
      const guessed = await helperGuess(model, r.text);
      if (guessed) return guessed;
    }
  } catch {
    /* */
  }
  return lookupKnown(model);
}

export async function applyCloudContext(): Promise<string | null> {
  const { useIde } = await import("@/store/ide");
  const st = useIde.getState();
  if (!wantsAutoContext(st.llmProvider)) return null;
  if (!st.llmContextAuto) st.setLlmContextAuto(true);
  const hit = await resolveModelContext(st.llmModel, st.llmProvider);
  if (!hit) return null;
  const n = anvilContext(hit.n);
  if (n !== st.llmContext) st.setLlmContext(n);
  return ctxLabel(hit);
}
