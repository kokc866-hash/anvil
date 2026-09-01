export type BrainKind = "tiny" | "chat" | "think";
export type BrainGroup = "fast" | "fit" | "upper";

export type BrainModel = {
  id: string;
  alt: string;
  label: string;
  size: string;
  vramMb: number;
  ctx: number;
  kind: BrainKind;
  group: BrainGroup;
  hint: string;
};

export const HELPER_GROUPS: { id: BrainGroup; label: string }[] = [
  { id: "fast", label: "Schnell · wenig VRAM" },
  { id: "fit", label: "Empfohlen" },
  { id: "upper", label: "Mehr GPU (~2–4 GB)" },
];

function m(
  id: string,
  alt: string,
  label: string,
  size: string,
  vramMb: number,
  kind: BrainKind,
  group: BrainGroup,
  hint: string,
  ctx = 8192,
): BrainModel {
  return { id, alt, label, size, vramMb, ctx, kind, group, hint };
}

/** Nur Instruct-Modelle, die als Helfer taugen (Kurzbefehl, JSON, Titel). Kein 7B, kein Coder. */
export const BRAIN_MODELS: BrainModel[] = [
  m(
    "SmolLM2-360M-Instruct-q4f16_1-MLC",
    "SmolLM2-360M-Instruct-q4f32_1-MLC",
    "SmolLM2 360M",
    "0.4 GB",
    376,
    "tiny",
    "fast",
    "Standard. Sehr schnell — Heuristik trägt, Modell nur wenn unsicher.",
  ),
  m(
    "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    "Qwen2.5-0.5B-Instruct-q4f32_1-MLC",
    "Qwen2.5 0.5B",
    "0.9 GB",
    945,
    "chat",
    "fast",
    "Kleines Qwen, etwas besserer Deutsch-JSON als 360M.",
  ),
  m(
    "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    "Llama-3.2-1B-Instruct-q4f32_1-MLC",
    "Llama 3.2 1B",
    "0.9 GB",
    880,
    "chat",
    "fast",
    "Stabil, folgt Anweisungen zuverlässig.",
  ),
  m(
    "gemma3-1b-it-q4f16_1-MLC",
    "gemma3-1b-it-q4f16_1-MLC",
    "Gemma 3 1B",
    "0.7 GB",
    711,
    "chat",
    "fast",
    "Kompakt, kurze Antworten.",
  ),
  m(
    "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC",
    "TinyLlama-1.1B-Chat-v1.0-q4f32_1-MLC",
    "TinyLlama 1.1B",
    "0.7 GB",
    700,
    "tiny",
    "fast",
    "Alt und leicht. Nur wenn sonst nichts lädt.",
    2048,
  ),
  m(
    "Qwen3-0.6B-q4f16_1-MLC",
    "Qwen3-0.6B-q4f32_1-MLC",
    "Qwen3 0.6B",
    "1.4 GB",
    1403,
    "think",
    "fit",
    "Mini-Qwen3. Gut für eine Zeile JSON.",
  ),
  m(
    "Qwen3.5-0.8B-q4f16_1-MLC",
    "Qwen3.5-0.8B-q4f32_1-MLC",
    "Qwen3.5 0.8B",
    "1.6 GB",
    1630,
    "think",
    "fit",
    "Helfer. Kurz, JSON, Titel — nicht der Agent.",
    32768,
  ),
  m(
    "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    "Qwen2.5-1.5B-Instruct-q4f32_1-MLC",
    "Qwen2.5 1.5B",
    "1.6 GB",
    1630,
    "chat",
    "fit",
    "Starker Allzweck-Helfer. Deutsch und Format besser als 360M.",
  ),
  m(
    "Qwen2-1.5B-Instruct-q4f16_1-MLC",
    "Qwen2-1.5B-Instruct-q4f32_1-MLC",
    "Qwen2 1.5B",
    "1.6 GB",
    1630,
    "chat",
    "fit",
    "Vorgänger von 2.5, falls 2.5 nicht lädt.",
  ),
  m(
    "OLMo-2-0425-1B-Instruct-q4f16_1-MLC",
    "OLMo-2-0425-1B-Instruct-q4f32_1-MLC",
    "OLMo 2 1B",
    "1.8 GB",
    1777,
    "chat",
    "fit",
    "Offen, nüchtern, kurze Instruktionen.",
  ),
  m(
    "SmolLM2-1.7B-Instruct-q4f16_1-MLC",
    "SmolLM2-1.7B-Instruct-q4f32_1-MLC",
    "SmolLM2 1.7B",
    "1.8 GB",
    1774,
    "chat",
    "fit",
    "Größeres Smol — gleicher Stil, weniger Müll.",
  ),
  m(
    "Qwen3-1.7B-q4f16_1-MLC",
    "Qwen3-1.7B-q4f32_1-MLC",
    "Qwen3 1.7B",
    "2.0 GB",
    2037,
    "think",
    "fit",
    "Empfohlen, wenn die GPU ~2 GB hat. JSON, Titel, Commit.",
  ),
  m(
    "gemma-2-2b-it-q4f16_1-MLC",
    "gemma-2-2b-it-q4f32_1-MLC",
    "Gemma 2 2B",
    "1.9 GB",
    1895,
    "chat",
    "fit",
    "Folgt Systemprompts strikt — gut fürs knappe Format.",
  ),
  m(
    "Qwen3.5-2B-q4f16_1-MLC",
    "Qwen3.5-2B-q4f32_1-MLC",
    "Qwen3.5 2B",
    "2.2 GB",
    2245,
    "think",
    "fit",
    "Aktuelles Qwen, etwas schwerer als 1.7B.",
  ),
  m(
    "stablelm-2-zephyr-1_6b-q4f16_1-MLC",
    "stablelm-2-zephyr-1_6b-q4f32_1-MLC",
    "StableLM Zephyr 1.6B",
    "2.1 GB",
    2088,
    "chat",
    "fit",
    "Kurz und direkt, älteres Instruct.",
  ),
  m(
    "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    "Llama-3.2-3B-Instruct-q4f32_1-MLC",
    "Llama 3.2 3B",
    "2.3 GB",
    2264,
    "chat",
    "upper",
    "Oberes Mini. Mehr als der Helfer braucht, sehr folgsam.",
  ),
  m(
    "Hermes-3-Llama-3.2-3B-q4f16_1-MLC",
    "Hermes-3-Llama-3.2-3B-q4f32_1-MLC",
    "Hermes 3 3B",
    "2.3 GB",
    2264,
    "chat",
    "upper",
    "Tool-/JSON-lastig. Gut wenn 1.7B zu frei schreibt.",
  ),
  m(
    "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    "Qwen2.5-3B-Instruct-q4f32_1-MLC",
    "Qwen2.5 3B",
    "2.5 GB",
    2505,
    "chat",
    "upper",
    "Kein Qwen3-3B im Katalog — das ist der 3B-Helfer.",
  ),
  m(
    "Ministral-3-3B-Instruct-2512-BF16-q4f16_1-MLC",
    "Ministral-3-3B-Instruct-2512-BF16-q4f32_1-MLC",
    "Ministral 3 3B",
    "2.9 GB",
    2864,
    "chat",
    "upper",
    "Mistral Instruct, knapp und strukturiert.",
  ),
  m(
    "Qwen3-4B-q4f16_1-MLC",
    "Qwen3-4B-q4f32_1-MLC",
    "Qwen3 4B",
    "3.4 GB",
    3432,
    "think",
    "upper",
    "Maximum für den Helfer. Darüber: Hauptmodell (Ollama).",
  ),
  m(
    "Qwen3.5-4B-q4f16_1-MLC",
    "Qwen3.5-4B-q4f32_1-MLC",
    "Qwen3.5 4B",
    "3.9 GB",
    3868,
    "think",
    "upper",
    "Schwer. Nur mit viel VRAM — immer noch kein Agent.",
  ),
  m(
    "Phi-3.5-mini-instruct-q4f16_1-MLC",
    "Phi-3.5-mini-instruct-q4f32_1-MLC",
    "Phi 3.5 Mini",
    "3.7 GB",
    3672,
    "chat",
    "upper",
    "Sehr folgsam bei Format. Langsamer Download.",
  ),
  m(
    "Phi-4-mini-instruct-q4f16_1-MLC",
    "Phi-4-mini-instruct-q4f32_1-MLC",
    "Phi 4 Mini",
    "3.4 GB",
    3438,
    "chat",
    "upper",
    "Neues Phi. Gut für knappe Instruktionen.",
  ),
];

export const DEFAULT_BRAIN_MODEL = "Qwen3.5-0.8B-q4f16_1-MLC";
export const HELPER_SMALL = ["Qwen3.5-0.8B-q4f16_1-MLC"] as const;
const OLD_DEFAULTS = [
  "Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC",
  "Qwen2.5-Coder-0.5B-Instruct-q4f32_1-MLC",
  "SmolLM2-360M-Instruct-q4f16_1-MLC",
  "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
];

/** WebLLM-IDs zum Eintippen (Custom). Katalog zuerst, dann weitere Mini-Modelle. */
export const WEBLLM_SUGGESTIONS: string[] = [
  ...BRAIN_MODELS.map((m) => m.id),
  "Qwen2-0.5B-Instruct-q4f16_1-MLC",
  "Qwen2.5-3B-Instruct-q4f16_1-MLC",
  "Qwen3.5-2B-q4f16_1-MLC",
  "Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC",
  "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC",
  "DeepSeek-R1-Distill-Qwen-1.5B-q4f16_1-MLC",
  "gemma-2-2b-it-q4f16_1-MLC",
  "Llama-3.2-1B-Instruct-q4f16_1-MLC",
].filter((id, i, arr) => arr.indexOf(id) === i);

export function migrateBrainModel(id: string | undefined): string {
  if (!id || OLD_DEFAULTS.includes(id) || /[-.]4B-q4f/i.test(id)) return DEFAULT_BRAIN_MODEL;
  return id;
}

export function brainModelOf(id: string): BrainModel | undefined {
  return BRAIN_MODELS.find((m) => m.id === id || m.alt === id);
}

export function resolveBrainId(id: string, fp16: boolean): string {
  const m = brainModelOf(id);
  if (!m) return id;
  return fp16 ? m.id : m.alt;
}
