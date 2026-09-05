export type ProviderKind = "builtin" | "local" | "cloud";
export type ProviderApi = "openai" | "anthropic" | "azure";

export type ProviderId =
  | "grok"
  | "brain"
  | "ollama"
  | "lmstudio"
  | "llamacpp"
  | "vllm"
  | "localai"
  | "jan"
  | "gpt4all"
  | "koboldcpp"
  | "textgen"
  | "openwebui"
  | "openai"
  | "anthropic"
  | "google"
  | "groq"
  | "together"
  | "fireworks"
  | "mistral"
  | "deepseek"
  | "openrouter"
  | "xai"
  | "perplexity"
  | "cohere"
  | "huggingface"
  | "cerebras"
  | "nvidia"
  | "github"
  | "azure"
  | "codex"
  | "custom";

export type ProviderSpec = {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
  api: ProviderApi;
  baseUrl: string;
  model: string;
  models: string[];
  needsKey: boolean;
  needsUrl: boolean;
  needsSub?: "codex" | "claude" | "gemini" | "copilot" | "huggingface";
  hint: string;
};

export const PROVIDERS: ProviderSpec[] = [
  {
    id: "grok",
    label: "Anvil",
    kind: "builtin",
    api: "openai",
    baseUrl: "",
    model: "grok-4.5",
    models: ["grok-4.5"],
    needsKey: false,
    needsUrl: false,
    hint: "Eingebaut, wenn die App ihn bereitstellt. Sonst Ollama oder OpenAI.",
  },
  {
    id: "brain",
    label: "Lokaler Helfer",
    kind: "builtin",
    api: "openai",
    baseUrl: "",
    model: "SmolLM2-360M-Instruct-q4f16_1-MLC",
    models: [],
    needsKey: false,
    needsUrl: false,
    hint: "Kein Agent. Nur Kurzbefehle. Hauptmodell unter Agent wählen.",
  },
  {
    id: "ollama",
    label: "Ollama",
    kind: "local",
    api: "openai",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "llama3.1",
    models: ["llama3.1", "llama3.2", "qwen2.5-coder", "codellama", "mistral"],
    needsKey: false,
    needsUrl: true,
    hint: "Standard ist dieser PC (127.0.0.1). Anderer Rechner im Netz: URL http://IP:11434/v1 eintragen.",
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    kind: "local",
    api: "openai",
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "local-model",
    models: [],
    needsKey: false,
    needsUrl: true,
    hint: "Local Server starten, CORS im Server-Tab einschalten.",
  },
  {
    id: "llamacpp",
    label: "llama.cpp",
    kind: "local",
    api: "openai",
    baseUrl: "http://127.0.0.1:8080/v1",
    model: "local",
    models: [],
    needsKey: false,
    needsUrl: true,
    hint: "llama-server mit OpenAI-kompatiblem Endpunkt.",
  },
  {
    id: "vllm",
    label: "vLLM",
    kind: "local",
    api: "openai",
    baseUrl: "http://127.0.0.1:8000/v1",
    model: "",
    models: [],
    needsKey: false,
    needsUrl: true,
    hint: "vLLM OpenAI-Server (typisch Port 8000).",
  },
  {
    id: "localai",
    label: "LocalAI",
    kind: "local",
    api: "openai",
    baseUrl: "http://127.0.0.1:8080/v1",
    model: "gpt-4",
    models: [],
    needsKey: false,
    needsUrl: true,
    hint: "LocalAI Drop-in für OpenAI.",
  },
  {
    id: "jan",
    label: "Jan",
    kind: "local",
    api: "openai",
    baseUrl: "http://127.0.0.1:1337/v1",
    model: "",
    models: [],
    needsKey: false,
    needsUrl: true,
    hint: "Jan Local API (Port 1337).",
  },
  {
    id: "gpt4all",
    label: "GPT4All",
    kind: "local",
    api: "openai",
    baseUrl: "http://127.0.0.1:4891/v1",
    model: "local",
    models: [],
    needsKey: false,
    needsUrl: true,
    hint: "GPT4All Local API (Port 4891).",
  },
  {
    id: "koboldcpp",
    label: "KoboldCpp",
    kind: "local",
    api: "openai",
    baseUrl: "http://127.0.0.1:5001/v1",
    model: "local",
    models: [],
    needsKey: false,
    needsUrl: true,
    hint: "KoboldCpp mit Chat Completions.",
  },
  {
    id: "textgen",
    label: "text-generation-webui",
    kind: "local",
    api: "openai",
    baseUrl: "http://127.0.0.1:5000/v1",
    model: "",
    models: [],
    needsKey: false,
    needsUrl: true,
    hint: "oobabooga OpenAI-Erweiterung.",
  },
  {
    id: "openwebui",
    label: "Open WebUI",
    kind: "local",
    api: "openai",
    baseUrl: "http://127.0.0.1:3000/api/v1",
    model: "",
    models: [],
    needsKey: false,
    needsUrl: true,
    hint: "Open WebUI als OpenAI-Proxy zu lokalen Modellen.",
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "cloud",
    api: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    models: ["gpt-6-astra", "gpt-5.5", "gpt-5.6-terra", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "o3", "o4-mini"],
    needsKey: true,
    needsUrl: false,
    hint: "API-Key von platform.openai.com",
  },
  {
    id: "codex",
    label: "Codex (ChatGPT-Abo)",
    kind: "cloud",
    api: "openai",
    baseUrl: "https://chatgpt.com/backend-api/codex",
    model: "gpt-5.6-terra",
    models: ["gpt-6-astra", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.5"],
    needsKey: false,
    needsUrl: false,
    needsSub: "codex",
    hint: "ChatGPT Plus/Pro. Magazin → Abo → Anmelden. terra / luna / sol — nicht gpt-*-codex (API).",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    kind: "cloud",
    api: "anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-5",
    models: ["claude-opus-5", "claude-sonnet-5", "claude-fable-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
    needsKey: true,
    needsUrl: false,
    needsSub: "claude",
    hint: "Abo: claude /login, Magazin → Abo → Laden. Cloud-Tab: API-Key von console.anthropic.com.",
  },
  {
    id: "google",
    label: "Google Gemini",
    kind: "cloud",
    api: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
    models: ["gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    needsKey: true,
    needsUrl: false,
    hint: "API-Key von aistudio.google.com. Gemini-CLI-Abo geht in Anvil nicht.",
  },
  {
    id: "groq",
    label: "Groq",
    kind: "cloud",
    api: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "qwen-qwq-32b"],
    needsKey: true,
    needsUrl: false,
    hint: "Schnelle Cloud-Inferenz. Key von console.groq.com",
  },
  {
    id: "together",
    label: "Together",
    kind: "cloud",
    api: "openai",
    baseUrl: "https://api.together.xyz/v1",
    model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-Coder-32B-Instruct"],
    needsKey: true,
    needsUrl: false,
    hint: "together.ai",
  },
  {
    id: "fireworks",
    label: "Fireworks",
    kind: "cloud",
    api: "openai",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    model: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    models: ["accounts/fireworks/models/llama-v3p3-70b-instruct"],
    needsKey: true,
    needsUrl: false,
    hint: "fireworks.ai",
  },
  {
    id: "mistral",
    label: "Mistral",
    kind: "cloud",
    api: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-small-latest",
    models: ["mistral-small-latest", "mistral-large-latest", "codestral-latest"],
    needsKey: true,
    needsUrl: false,
    hint: "console.mistral.ai",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "cloud",
    api: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    needsKey: true,
    needsUrl: false,
    hint: "platform.deepseek.com",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "cloud",
    api: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openrouter/auto",
    models: ["openrouter/auto", "openai/gpt-6-astra", "anthropic/claude-sonnet-5", "google/gemini-2.5-flash"],
    needsKey: true,
    needsUrl: false,
    hint: "Ein Key, viele Modelle. openrouter.ai",
  },
  {
    id: "xai",
    label: "xAI",
    kind: "cloud",
    api: "openai",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-4.5",
    models: ["grok-4.5", "grok-4", "grok-3", "grok-3-mini"],
    needsKey: true,
    needsUrl: false,
    hint: "Eigener xAI-Key (console.x.ai).",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    kind: "cloud",
    api: "openai",
    baseUrl: "https://api.perplexity.ai",
    model: "sonar",
    models: ["sonar", "sonar-pro", "sonar-reasoning"],
    needsKey: true,
    needsUrl: false,
    hint: "perplexity.ai API",
  },
  {
    id: "cohere",
    label: "Cohere",
    kind: "cloud",
    api: "openai",
    baseUrl: "https://api.cohere.ai/compatibility/v1",
    model: "command-r-plus",
    models: ["command-r-plus", "command-r", "command-a-03-2025"],
    needsKey: true,
    needsUrl: false,
    hint: "dashboard.cohere.com",
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    kind: "cloud",
    api: "openai",
    baseUrl: "https://router.huggingface.co/v1",
    model: "meta-llama/Llama-3.1-8B-Instruct",
    models: ["meta-llama/Llama-3.1-8B-Instruct", "Qwen/Qwen2.5-Coder-32B-Instruct"],
    needsKey: true,
    needsUrl: false,
    hint: "Magazin → Abo → Laden (huggingface-cli login). Oder Token mit Inference einfügen.",
    needsSub: "huggingface",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    kind: "cloud",
    api: "openai",
    baseUrl: "https://api.cerebras.ai/v1",
    model: "llama-3.3-70b",
    models: ["llama-3.3-70b", "llama3.1-8b"],
    needsKey: true,
    needsUrl: false,
    hint: "cloud.cerebras.ai",
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM",
    kind: "cloud",
    api: "openai",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    model: "meta/llama-3.1-70b-instruct",
    models: ["meta/llama-3.1-70b-instruct", "meta/llama-3.1-8b-instruct"],
    needsKey: true,
    needsUrl: false,
    hint: "build.nvidia.com",
  },
  {
    id: "github",
    label: "GitHub Copilot",
    kind: "cloud",
    api: "openai",
    baseUrl: "https://api.githubcopilot.com",
    model: "gpt-4.1",
    models: ["gpt-4.1", "gpt-4o", "claude-sonnet-4", "gemini-2.5-pro"],
    needsKey: true,
    needsUrl: false,
    needsSub: "copilot",
    hint: "Abo: gh auth login, Magazin → Abo → Laden. Cloud-Tab: GitHub-Token als API.",
  },
  {
    id: "azure",
    label: "Azure OpenAI",
    kind: "cloud",
    api: "azure",
    baseUrl: "",
    model: "",
    models: [],
    needsKey: true,
    needsUrl: true,
    hint: "Resource-URL plus Deployment-Name als Modell.",
  },
  {
    id: "custom",
    label: "Custom",
    kind: "cloud",
    api: "openai",
    baseUrl: "http://127.0.0.1:8000/v1",
    model: "",
    models: [],
    needsKey: false,
    needsUrl: true,
    hint: "Beliebige OpenAI-kompatible /v1/chat/completions API.",
  },
];

export const PROVIDER_GROUPS: { id: ProviderKind | "other"; label: string; ids: ProviderId[] }[] = [
  { id: "builtin", label: "Anvil", ids: ["grok"] },
  {
    id: "local",
    label: "Lokal",
    ids: ["ollama", "lmstudio", "llamacpp", "vllm", "localai", "jan", "gpt4all", "koboldcpp", "textgen", "openwebui"],
  },
  {
    id: "cloud",
    label: "Cloud",
    ids: [
      "openai",
      "codex",
      "anthropic",
      "google",
      "groq",
      "together",
      "fireworks",
      "mistral",
      "deepseek",
      "openrouter",
      "xai",
      "perplexity",
      "cohere",
      "huggingface",
      "cerebras",
      "nvidia",
      "github",
      "azure",
    ],
  },
  { id: "other", label: "Andere", ids: ["custom"] },
];

const BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p])) as Record<ProviderId, ProviderSpec>;

/** ChatGPT-Abo (nicht API). gpt-*-codex und 5.4 sind dort tot. */
const CODEX_CHAT = ["gpt-6-astra", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.5"] as const;
const CODEX_ALIAS: Record<string, string> = {
  "gpt-5.6-codex": "gpt-5.6-terra",
  "gpt-5.4": "gpt-5.6-terra",
  "gpt-5.4-mini": "gpt-5.6-luna",
  "gpt-5.3-codex": "gpt-5.6-luna",
  "gpt-5.2": "gpt-5.6-terra",
  o3: "gpt-5.6-terra",
  "o4-mini": "gpt-5.6-luna",
};

export function resolveCodexModel(id: string): string {
  const t = String(id || "").trim();
  if ((CODEX_CHAT as readonly string[]).includes(t)) return t;
  if (CODEX_ALIAS[t]) return CODEX_ALIAS[t];
  if (/codex/i.test(t) || /^gpt-5\.[0-4]/i.test(t)) return "gpt-5.6-terra";
  return t || "gpt-5.6-terra";
}

export function providerOf(id: string): ProviderSpec {
  return BY_ID[id as ProviderId] ?? BY_ID.custom;
}

export const PROVIDER_DEFAULTS = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, { baseUrl: p.baseUrl, model: p.model, label: p.label }]),
) as Record<ProviderId, { baseUrl: string; model: string; label: string }>;

export type LlmProvider = ProviderId;
