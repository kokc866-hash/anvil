export type ThinkingMode = "off" | "auto" | "low" | "medium" | "high";

export type LlmRuntime = {
  provider: string;
  model: string;
  api?: "openai" | "anthropic" | "azure";
  context: number;
  thinking: ThinkingMode;
  temperature?: number;
  maxOut?: number;
};

const THINK_RE =
  /r1|reason|think|qwq|qwen3|qwen2\.5|o1|o3|o4|gpt-5|gpt-6|grok-3|grok-4|sonnet-4|opus-4|opus-5|fable|haiku-4|deepseek-reason/i;

export function normalizeThinking(v: string): ThinkingMode {
  if (v === "on" || v === "mid") return "medium";
  if (v === "off" || v === "auto" || v === "low" || v === "medium" || v === "high") return v;
  return "auto";
}

export function wantsThinking(rt: LlmRuntime): boolean {
  if (rt.thinking === "off") return false;
  if (rt.thinking === "low" || rt.thinking === "medium" || rt.thinking === "high") return true;
  return THINK_RE.test(rt.model) || rt.provider === "grok" || rt.provider === "anthropic";
}

export function thinkingEffort(rt: LlmRuntime): "low" | "medium" | "high" {
  if (rt.thinking === "low") return "low";
  if (rt.thinking === "high") return "high";
  return "medium";
}

function thinkBudget(ctx: number, effort: "low" | "medium" | "high"): number {
  if (effort === "low") return Math.min(8192, Math.max(2048, Math.floor(ctx * 0.06)));
  if (effort === "high") return Math.min(32768, Math.max(8192, Math.floor(ctx * 0.25)));
  return Math.min(16384, Math.max(4096, Math.floor(ctx * 0.12)));
}

export { thinkBudget };

function clampTemp(n?: number): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0.3;
  return Math.min(2, Math.max(0, n));
}

export function clampMaxOut(n: number | undefined, ctx: number, local: boolean): number {
  if (typeof n === "number" && n > 0) return Math.min(65536, Math.max(16, Math.round(n)));
  return Math.min(65536, Math.max(2048, Math.floor(ctx * (local ? 0.18 : 0.35))));
}

export function needsCompletionTokens(model: string, provider = ""): boolean {
  if (provider === "anthropic" || provider === "ollama" || provider === "lmstudio" || provider === "llamacpp") {
    return false;
  }
  return /gpt-5|gpt-6|o1-|o1$|\bo1\b|o3-|o3$|o4-|o4$|codex|grok-4/i.test(model);
}

export function applyLlmOptions(
  payload: Record<string, unknown>,
  rt: LlmRuntime,
  opts?: { tools?: boolean },
): Record<string, unknown> {
  const ctx = Math.max(2048, rt.context || 32768);
  const local =
    rt.provider === "ollama" ||
    rt.provider === "lmstudio" ||
    rt.provider === "llamacpp" ||
    rt.provider === "localai" ||
    rt.provider === "jan" ||
    rt.provider === "vllm" ||
    rt.provider === "koboldcpp" ||
    rt.provider === "textgen" ||
    rt.provider === "openwebui" ||
    rt.provider === "gpt4all" ||
    rt.provider === "custom";
  const temp = clampTemp(rt.temperature);
  const maxOut = clampMaxOut(rt.maxOut, ctx, local);
  const think = wantsThinking(rt);
  const effort = thinkingEffort(rt);
  const budget = think ? thinkBudget(ctx, effort) : 0;
  const anthropic = rt.api === "anthropic" || rt.provider === "anthropic";
  const completion = !anthropic && needsCompletionTokens(rt.model, rt.provider);

  if (completion) {
    payload.max_completion_tokens = maxOut;
    delete payload.max_tokens;
    delete payload.temperature;
  } else {
    payload.max_tokens = maxOut;
    delete payload.max_completion_tokens;
    payload.temperature = temp;
  }

  if (local) {
    const predict = Math.min(Math.floor(ctx * 0.22), Math.max(maxOut, think ? maxOut + Math.min(budget, Math.floor(ctx * 0.08)) : maxOut));
    payload.keep_alive = "30m";
    payload.n_ctx = ctx;
    payload.temperature = temp;
    payload.options = {
      ...((payload.options as object) || {}),
      num_ctx: ctx,
      n_ctx: ctx,
      num_predict: predict,
      temperature: temp,
      keep_alive: "30m",
    };
    if (think) {
      delete payload.max_tokens;
      payload.think = rt.thinking === "auto" ? true : effort;
      (payload.options as Record<string, unknown>).think = payload.think;
    } else {
      payload.think = false;
      (payload.options as Record<string, unknown>).think = false;
    }
    if (rt.provider === "ollama") {
      delete payload.n_ctx;
      delete payload.enable_thinking;
      delete payload.reasoning_budget;
      delete payload.chat_template_kwargs;
    } else if (think) {
      payload.enable_thinking = true;
      payload.reasoning_budget = budget;
      payload.chat_template_kwargs = {
        ...((payload.chat_template_kwargs as object) || {}),
        enable_thinking: true,
      };
    } else {
      payload.enable_thinking = false;
      payload.reasoning_budget = 0;
      payload.chat_template_kwargs = {
        ...((payload.chat_template_kwargs as object) || {}),
        enable_thinking: false,
      };
    }
    delete payload.stream_options;
  }

  if (!think) {
    delete payload.reasoning_effort;
    return payload;
  }

  if (anthropic) {
    const maxTok = Math.max(maxOut, budget + 2048);
    payload.max_tokens = maxTok;
    payload.thinking = { type: "enabled", budget_tokens: Math.min(budget, maxTok - 1024) };
    payload.temperature = 1;
    delete payload.max_completion_tokens;
  } else if (completion || rt.provider === "grok" || rt.provider === "xai" || /grok/i.test(rt.model)) {
    payload.reasoning_effort = effort;
  } else if (local) {
    /* think + num_predict already set */
  }
  return payload;
}

/** Nur OpenAI- und Azure-Host. OpenRouter/Groq/xAI: Chat Completions. */
export function usesResponsesApi(rt: LlmRuntime, tools: boolean): boolean {
  if (rt.provider !== "openai" && rt.provider !== "azure") return false;
  if (!tools) return false;
  if (!wantsThinking(rt)) return false;
  return /gpt-5|gpt-6|o1|o3|o4|codex/i.test(rt.model);
}

const CODEX_KEYS = new Set([
  "model",
  "input",
  "instructions",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "reasoning",
  "store",
  "stream",
]);

const KEEP_WIRE = new Set(["model", "input", "messages", "instructions"]);

function wireKey(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        if (c && typeof c === "object" && "text" in (c as object)) return String((c as { text?: string }).text ?? "");
        return "";
      })
      .join("\n");
  }
  return content == null ? "" : String(content);
}

/** Chat-Messages → Responses `input`. Nie leer — OpenAI 400 sonst. */
export function toResponsesInput(messages: Record<string, unknown>[]): { instructions: string; input: unknown[] } {
  const inst: string[] = [];
  const input: unknown[] = [];
  const calls = new Set<string>();
  for (const m of messages) {
    const role = String(m.role ?? "");
    if (role === "system") {
      inst.push(textOf(m.content));
      continue;
    }
    if (role === "tool") {
      const id = String(m.tool_call_id ?? "");
      if (id && calls.has(id)) {
        input.push({ type: "function_call_output", call_id: id, output: textOf(m.content) });
      } else {
        const t = textOf(m.content).trim();
        if (t) input.push({ role: "user", content: t });
      }
      continue;
    }
    if (role === "assistant" && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls as { id?: string; function?: { name?: string; arguments?: string } }[]) {
        const id = String(tc.id || "");
        if (id) calls.add(id);
        input.push({
          type: "function_call",
          call_id: id || `call_${calls.size}`,
          name: tc.function?.name,
          arguments: tc.function?.arguments || "{}",
        });
      }
      const t = textOf(m.content);
      if (t) input.push({ role: "assistant", content: t });
      continue;
    }
    input.push({ role, content: textOf(m.content) });
  }
  const instructions = inst.filter(Boolean).join("\n\n");
  if (!input.length) input.push({ role: "user", content: instructions || " " });
  return { instructions, input };
}

export function responsesBody(
  payload: Record<string, unknown>,
  kind = "",
): Record<string, unknown> {
  const { instructions, input } = toResponsesInput((payload.messages as Record<string, unknown>[]) ?? []);
  const effort = payload.reasoning_effort;
  const body = applyResponsesStore(
    {
      model: payload.model,
      input,
      instructions: instructions || undefined,
      max_output_tokens: payload.max_completion_tokens ?? payload.max_tokens,
    },
    kind,
  );
  if (effort) body.reasoning = { effort };
  if (!Array.isArray(body.input) || (body.input as unknown[]).length === 0) {
    body.input = [{ role: "user", content: instructions || " " }];
  }
  return body;
}

/** Codex-Abo lehnt include/max_output_tokens ab. API-Responses: store false + encrypted reasoning. */
export function applyResponsesStore(body: Record<string, unknown>, kind = ""): Record<string, unknown> {
  body.store = false;
  body.stream = true;
  if (kind === "codex") {
    body.parallel_tool_calls = false;
    delete body.include;
    for (const k of Object.keys(body)) {
      if (!CODEX_KEYS.has(k)) delete body[k];
    }
  } else {
    body.include = ["reasoning.encrypted_content"];
  }
  return body;
}

/** FastAPI / OpenAI 400: unsupported field raus, must-be true|false setzen. Nie input/model löschen. */
export function patchResponses400(body: Record<string, unknown>, raw: string): boolean {
  let hit = false;
  const names = new Set<string>();
  const add = (s: string | undefined) => {
    if (!s) return;
    names.add(wireKey(s));
  };
  add(raw.match(/Unsupported parameter:\s*['"]?([A-Za-z0-9_]+)/i)?.[1]);
  add(raw.match(/Unknown parameter:\s*['"]?([A-Za-z0-9_]+)/i)?.[1]);
  add(raw.match(/does not support parameter\s+['"]?([A-Za-z0-9_]+)/i)?.[1]);
  add(raw.match(/['"]([A-Za-z0-9_]+)['"]\s+is not supported/i)?.[1]);
  const missing = /missing_required_parameter|Missing required parameter/i.test(raw);
  if (!missing) add(raw.match(/"param"\s*:\s*"([A-Za-z0-9_]+)"/i)?.[1]);
  for (const key of names) {
    if (KEEP_WIRE.has(key)) continue;
    if (key in body) {
      delete body[key];
      hit = true;
    }
  }
  const must = raw.match(/\b([A-Za-z0-9_]+)\s+must be set to\s+(true|false)/i);
  if (must) {
    const key = wireKey(must[1]);
    const val = must[2].toLowerCase() === "true";
    if (body[key] !== val) {
      body[key] = val;
      hit = true;
    }
  }
  if (missing && /['"]?input['"]?/i.test(raw) && (body.input == null || (Array.isArray(body.input) && body.input.length === 0))) {
    const fromMsg = (body.messages as Record<string, unknown>[] | undefined) ?? [];
    const packed = toResponsesInput(fromMsg);
    body.input = packed.input;
    if (packed.instructions) body.instructions = packed.instructions;
    hit = true;
  }
  return hit;
}

export function toResponsesTools(
  tools: { function: { name: string; description?: string; parameters?: unknown } }[],
): { type: "function"; name: string; description?: string; parameters: unknown }[] {
  return tools.map((t) => ({
    type: "function",
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters ?? { type: "object", properties: {} },
  }));
}

export function toolCode(
  name: string,
  args: Record<string, unknown>,
): { path?: string; code?: string; before?: string } {
  if (name === "write_file") {
    return { path: String(args.path ?? ""), code: String(args.content ?? "").slice(0, 12000) };
  }
  if (name === "edit_file") {
    return {
      path: String(args.path ?? ""),
      before: String(args.old_string ?? "").slice(0, 8000),
      code: String(args.new_string ?? "").slice(0, 8000),
    };
  }
  return {};
}

export function toolDetail(name: string, args: Record<string, unknown>, result?: unknown): string {
  const path = String(args.path ?? args.from ?? args.url ?? args.command ?? args.query ?? args.message ?? "");
  if (name === "write_file" || name === "edit_file") return String(args.path ?? path);
  if (name === "read_file") return String(args.path ?? "");
  if (name === "delete_file" || name === "mkdir") return String(args.path ?? "");
  if (name === "rename") return `${args.from} → ${args.to}`;
  if (name === "grep") return String(args.query ?? "");
  if (name === "shell") return String(args.command ?? "");
  if (name === "git_commit" || name === "git_push") return String(args.message ?? "commit");
  if (name === "git_clone") return String(args.url ?? "");
  if (name === "run_file" || name === "format_file" || name === "open_preview") return String(args.path ?? "");
  if (name === "engine_run") return String(args.action ?? args.cmd ?? "run");
  if (name === "mcp_call") return `${args.server ?? ""}.${args.name ?? ""}`;
  if (name === "mcp_list") return "MCP";
  if (name === "engine_detect" || name === "engine_status") return "Engine";
  if (name === "play") return Array.isArray(args.keys) ? (args.keys as string[]).join(" ") : String(args.keys ?? "play");
  if (name === "see_run") return "Canvas";
  if (name === "ask_user") return String(args.prompt ?? args.question ?? "Nachfrage");
  if (name === "harness_write" || name === "harness_read") return String(args.name ?? args.afterWrite ?? ".anvil/harness.json");
  if (name === "graph_write") return `${Array.isArray(args.edges) ? (args.edges as unknown[]).length : 0} Kanten`;
  if (name === "board_read" || name === "board_open") return "Tafel";
  if (name === "board_reset") return "Standard";
  if (name === "board_write") {
    if (args.reset) return "Standard";
    if (args.tool) return String(args.tool);
    if (args.from && args.to) return `${args.from} → ${args.to}`;
    if (args.remove) return `weg ${args.remove}`;
    return "Tafel";
  }
  if (result && typeof result === "object" && result && "tries_left" in result) {
    return `${path} · noch ${(result as { tries_left?: number }).tries_left}×`;
  }
  if (result && typeof result === "object" && "error" in result) return String((result as { error: string }).error);
  return path;
}
