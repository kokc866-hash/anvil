export type ToolMode = "unknown" | "ok" | "text" | "off";

export type ModelCap = {
  tools: ToolMode;
  noThinkWithTools: boolean;
  noStreamTools: boolean;
  noRequired: boolean;
  responsesApi: boolean;
  note: string;
  at: number;
};

const LS = "anvil-model-caps";
const MAX = 80;
const EVT = "anvil-caps";

let mem: Record<string, ModelCap> = {};
let loaded = false;
let target = { provider: "", model: "" };

function empty(): ModelCap {
  return {
    tools: "unknown",
    noThinkWithTools: false,
    noStreamTools: false,
    noRequired: false,
    responsesApi: false,
    note: "",
    at: 0,
  };
}

export function capKey(provider: string, model: string): string {
  const key = String(provider || "").trim();
  // Errors learned on /v1 must not disable tools/thinking on native /api/chat.
  return `${key === "ollama" ? "ollama-native-chat" : key}::${String(model || "").trim().toLowerCase()}`;
}

function load(): Record<string, ModelCap> {
  if (loaded) return mem;
  loaded = true;
  try {
    if (typeof localStorage === "undefined") return mem;
    const raw = localStorage.getItem(LS);
    if (!raw) return mem;
    const v = JSON.parse(raw) as Record<string, ModelCap>;
    if (v && typeof v === "object") mem = v;
  } catch {
    mem = {};
  }
  return mem;
}

function save() {
  const all = load();
  const keys = Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0));
  if (keys.length > MAX) {
    for (const k of keys.slice(MAX)) delete all[k];
  }
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(LS, JSON.stringify(all));
  } catch {
    /* quota */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

function seed(provider: string, model: string): Partial<ModelCap> {
  const m = model || "";
  if (provider === "codex") return { noThinkWithTools: true };
  if ((provider === "openai" || provider === "azure") && /gpt-5|gpt-6|o1|o3|o4|codex/i.test(m)) {
    return { responsesApi: true };
  }
  if (provider === "llamacpp" || provider === "ollama") return {};
  return {};
}

export function bindCapTarget(provider: string, model: string) {
  target = { provider, model };
}

export function getCap(provider = target.provider, model = target.model): ModelCap {
  const k = capKey(provider, model);
  if (!k || k === "::") return empty();
  const hit = load()[k];
  if (hit) return { ...empty(), ...hit };
  return { ...empty(), ...seed(provider, model) };
}

export function setCap(provider: string, model: string, patch: Partial<ModelCap>) {
  const k = capKey(provider, model);
  if (!k || k === "::") return getCap(provider, model);
  const prev = getCap(provider, model);
  const next: ModelCap = { ...prev, ...patch, at: Date.now() };
  load()[k] = next;
  save();
  return next;
}

export function resetCap(provider: string, model: string) {
  const k = capKey(provider, model);
  delete load()[k];
  save();
}

export function capLabel(cap: ModelCap): string {
  if (cap.tools === "off") return "keine Tools";
  if (cap.tools === "text") return "Tools als Text";
  if (cap.tools === "ok") return "Tools ok";
  const bits: string[] = [];
  if (cap.noThinkWithTools) bits.push("Thinking aus bei Tools");
  if (cap.noStreamTools) bits.push("ohne Stream");
  if (cap.noRequired) bits.push("choice auto");
  if (cap.responsesApi) bits.push("Responses");
  if (cap.note) bits.push(cap.note);
  return bits.length ? bits.join(" · ") : "noch nichts gemerkt";
}

export function classifyLlmError(status: number, body: string): Partial<ModelCap> | null {
  const t = `${status} ${body}`;
  if (status !== 400 && status !== 422 && !/jinja|template|tool call type|reasoning_effort/i.test(t)) return null;
  const patch: Partial<ModelCap> = { note: "" };
  let hit = false;
  if (/reasoning_effort|function tools with reasoning|tools with reasoning/i.test(t)) {
    patch.noThinkWithTools = true;
    patch.note = "Thinking bei Tools aus";
    hit = true;
  }
  if (/missing tool call type|tool call type/i.test(t)) {
    patch.note = patch.note || "type:function";
    hit = true;
  }
  if (/system message must be at the beginning|system message/i.test(t) && /jinja|template/i.test(t)) {
    patch.note = patch.note || "eine System-Nachricht";
    hit = true;
  }
  if (/tool_choice|required.*not support/i.test(t)) {
    patch.noRequired = true;
    patch.note = patch.note || "tool_choice auto";
    hit = true;
  }
  if (/stream.*tool|tool.*stream|streaming.*not support/i.test(t)) {
    patch.noStreamTools = true;
    patch.note = patch.note || "ohne Stream";
    hit = true;
  }
  if (/does not support tools|unknown field.*\btools\b|tools are not enabled|tool use is not supported|\"tools\".*unexpected/i.test(t)) {
    patch.tools = "text";
    patch.note = "Tools als Text";
    hit = true;
  }
  return hit ? patch : null;
}

export function learnFromError(provider: string, model: string, status: number, body: string): ModelCap | null {
  const patch = classifyLlmError(status, body);
  if (!patch) return null;
  const prev = getCap(provider, model);
  const same =
    (patch.noThinkWithTools ? prev.noThinkWithTools : true) &&
    (patch.noStreamTools ? prev.noStreamTools : true) &&
    (patch.noRequired ? prev.noRequired : true) &&
    (patch.tools ? prev.tools === patch.tools : true);
  if (same && prev.at) return null;
  const next = setCap(provider, model, patch);
  void import("./app-log").then((m) => m.appLog("cap", `${provider} ${model} ${next.note || capLabel(next)}`));
  return next;
}

export function noteToolSuccess(structured: boolean) {
  const { provider, model } = target;
  if (!provider || !model) return;
  const prev = getCap(provider, model);
  if (structured) {
    if (prev.tools === "ok") return;
    setCap(provider, model, { tools: "ok", note: prev.note });
    return;
  }
  if (prev.tools === "unknown") setCap(provider, model, { tools: "ok", note: prev.note });
}

export function noteHarvest() {
  const { provider, model } = target;
  if (!provider || !model) return;
  const prev = getCap(provider, model);
  if (prev.tools === "ok") return;
  if (prev.tools === "text") return;
  setCap(provider, model, { tools: "text", note: "Tools als Text" });
}

export function applyCapToPayload(payload: Record<string, unknown>, cap: ModelCap, toolsOn: boolean): boolean {
  let tools = toolsOn && cap.tools !== "off" && cap.tools !== "text";
  if (!tools) {
    delete payload.tools;
    delete payload.tool_choice;
  }
  if (tools && cap.noRequired && payload.tool_choice === "required") payload.tool_choice = "auto";
  if (tools && cap.noStreamTools) payload.stream = false;
  if (tools && cap.noThinkWithTools) {
    delete payload.think;
    delete payload.reasoning_effort;
    delete payload.thinking;
    delete payload.reasoning;
    const opt = payload.options as Record<string, unknown> | undefined;
    if (opt) delete opt.think;
  }
  return tools;
}

export function sendTools(cap: ModelCap, want: boolean): boolean {
  if (!want) return false;
  if (cap.tools === "off" || cap.tools === "text") return false;
  return true;
}
