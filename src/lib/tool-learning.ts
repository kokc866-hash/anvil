import { AGENT_TOOLS } from "./agent-tools.ts";
import { parseTextTool, toolTargetKey, validateToolCall, type ToolCompatibility, type ToolContract } from "./tool-compat.ts";
import type { ToolCall } from "./tool-call.ts";

export type ToolLearningMode = "off" | "observe" | "auto";
export type ToolShape = { wire: "native" | "text"; envelope: string; name: string; fields: string[] };
export type ToolMapping = { name: string; fields: Record<string, string>; schema: string };
export type ToolRule = {
  id: string; shape: ToolShape; candidates: ToolMapping[]; target?: string;
  enabled: boolean; review: boolean; status: "observed" | "learned" | "manual";
  seen: number; successes: number; failures: number; at: number; revision: number;
};
export type ToolLearning = { mode?: ToolLearningMode; rules: ToolRule[] };
export type ToolLearningState = Record<string, ToolLearning>;
export const LEARNING_LIMITS = { targets: 24, rules: 24, fields: 32, input: 512_000 };
const TOOLS = new Map(AGENT_TOOLS.map((t) => [t.function.name, t.function]));
const NAME_KEYS = ["name", "tool", "function"];
const ARG_KEYS = ["arguments", "args", "parameters", "params"];
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const FIELD_ALIASES: Record<string, string[]> = {
  path: ["file", "filename", "file_path", "filepath"], content: ["text"], query: ["pattern"],
  old_string: ["old_text"], new_string: ["new_text"], from: ["from_path"], to: ["to_path"],
};
// These are candidate sets, never fuzzy guesses or executable user-defined code.
const NAME_ALIASES: Record<string, string[]> = {
  read: ["read_file", "skill_read", "harness_read", "board_read"],
  write: ["write_file", "skill_write", "harness_write", "board_write"],
  append: ["append_file"], edit: ["edit_file"], search: ["grep"],
  save: ["write_file", "skill_write", "harness_write", "board_write"],
  open: ["read_file", "open_preview"], run: ["run_file", "skill_run", "engine_run"],
  execute: ["run_file", "shell", "engine_run"], delete: ["delete_file", "memory_forget"],
};
const NEEDS_REVIEW = new Set(["save", "open", "run", "execute", "delete"]);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const identifier = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z_][A-Za-z0-9_.]{0,95}$/.test(v) && !BAD_KEYS.has(v);
const normalize = (s: string) => s.replace(/^(?:functions|tools)\./, "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
const namesFor = (name: string) => { const n = normalize(name); return TOOLS.has(n) ? [n] : NAME_ALIASES[n] || []; };
export const toolShapeKey = (shape: ToolShape) => JSON.stringify([1, shape.wire, shape.envelope, shape.name, [...shape.fields].sort()]);
const mappingKey = (m: ToolMapping) => JSON.stringify([m.name, Object.entries(m.fields).sort(), m.schema]);
const candidatesKey = (c: ToolMapping[]) => JSON.stringify(c.map(mappingKey).sort());
function safeValue(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (Array.isArray(value)) return value.every((v) => safeValue(v, depth + 1));
  return !object(value) || Object.entries(value).every(([key, v]) => !BAD_KEYS.has(key) && safeValue(v, depth + 1));
}
export function toolLearningMode(value: unknown, compatibility: ToolCompatibility = "standard"): ToolLearningMode {
  return value === "off" || value === "observe" || value === "auto" ? value : compatibility === "standard" ? "observe" : "auto";
}

/** Only top-level field names are translated. Nested payloads (especially MCP) stay intact. */
function mappingPlans(shape: ToolShape): ToolMapping[] {
  return namesFor(shape.name).flatMap((name) => {
    const spec = TOOLS.get(name);
    if (!spec) return [];
    const props = spec.parameters.properties;
    const fields: Record<string, string> = {};
    for (const source of shape.fields) {
      const key = normalize(source);
      const matches = Object.keys(props).filter((p) => normalize(p) === key || FIELD_ALIASES[p]?.includes(key));
      const dest = Object.hasOwn(props, source) ? source : matches.length === 1 ? matches[0] : undefined;
      if (!dest || Object.values(fields).includes(dest)) return []; // Never drop arguments or resolve collisions.
      fields[source] = dest;
    }
    if (spec.parameters.required.some((r) => !Object.values(fields).includes(r))) return [];
    return [{ name, fields, schema: JSON.stringify(spec.parameters) }];
  });
}
function translate(call: ToolCall, args: Record<string, unknown>, mapping: ToolMapping): ToolCall {
  return { ...call, function: { name: mapping.name, arguments: JSON.stringify(Object.fromEntries(Object.entries(mapping.fields).map(([from, to]) => [to, args[from]]))) } };
}
type Observation = { shape: ToolShape; args: Record<string, unknown>; call: ToolCall; candidates: ToolMapping[] };
function observation(name: unknown, args: unknown, wire: ToolShape["wire"], envelope: string, call?: ToolCall): Observation | undefined {
  if (!identifier(name) || !object(args) || !safeValue(args)) return;
  const fields = Object.keys(args).sort();
  if (fields.length > LEARNING_LIMITS.fields || fields.some((f) => !identifier(f))) return;
  const shape: ToolShape = { wire, envelope, name, fields };
  const source = call || { id: `learn_${crypto.randomUUID()}`, type: "function" as const, function: { name, arguments: JSON.stringify(args) } };
  const candidates = mappingPlans(shape).filter((m) => !validateToolCall(translate(source, args, m), [m.name]).error);
  return candidates.length ? { shape, args, call: source, candidates } : undefined;
}

/** Text dialects are read only while the caller explicitly uses the text-tool protocol. */
export function observeToolText(content: string): Observation | undefined {
  if (content.length > LEARNING_LIMITS.input) return;
  try {
    const value: unknown = JSON.parse(content.trim());
    if (!object(value)) return;
    if (Object.keys(value).join() === "function" && object(value.function)) {
      const f = value.function;
      if (Object.keys(f).sort().join() !== "arguments,name") return;
      return observation(f.name, typeof f.arguments === "string" ? JSON.parse(f.arguments) : f.arguments, "text", "function");
    }
    const nameKey = Object.hasOwn(value, "tool") ? "tool" : NAME_KEYS.find((key) => Object.hasOwn(value, key));
    if (!nameKey) return;
    const argKeys = ARG_KEYS.filter((key) => Object.hasOwn(value, key));
    if (argKeys.length > 1) return;
    const argKey = argKeys[0];
    if (argKey && Object.keys(value).length !== 2) return;
    const args = argKey ? typeof value[argKey] === "string" ? JSON.parse(value[argKey] as string) : value[argKey]
      : Object.fromEntries(Object.entries(value).filter(([key]) => key !== nameKey));
    return observation(value[nameKey], args, "text", `${nameKey}:${argKey || "flat"}`);
  } catch { return; }
}

/** Persistence contains shapes and verified field bindings, never argument values or prompts. */
export function sanitizeToolLearning(value: unknown, imported = false): ToolLearningState {
  if (!object(value)) return {};
  const result: ToolLearningState = {};
  for (const [key, entry] of Object.entries(value).slice(-LEARNING_LIMITS.targets)) {
    if (!object(entry) || key.length > 2048) continue;
    try {
      const [provider, base, protocol, model, extra] = JSON.parse(key);
      if (extra !== undefined || ![provider, base, protocol, model].every((v) => typeof v === "string") ||
        key !== toolTargetKey(provider, model, base, protocol) || !/^https?:/.test(base)) continue;
    } catch { continue; }
    const rules: ToolRule[] = [];
    const seen = new Set<string>();
    const ids = new Set<string>();
    for (const raw of (Array.isArray(entry.rules) ? entry.rules.slice(-LEARNING_LIMITS.rules) : [])) {
      if (!object(raw) || !object(raw.shape) || !identifier(raw.shape.name)) continue;
      const s = raw.shape;
      if ((s.wire !== "native" && s.wire !== "text") || typeof s.envelope !== "string" ||
        !(s.wire === "native" ? s.envelope === "native" : s.envelope === "function" || /^(name|tool|function):(arguments|args|parameters|params|flat)$/.test(s.envelope)) ||
        !Array.isArray(s.fields) || s.fields.length > LEARNING_LIMITS.fields || !s.fields.every(identifier) || new Set(s.fields).size !== s.fields.length) continue;
      const shape: ToolShape = { wire: s.wire, envelope: s.envelope, name: s.name as string, fields: [...s.fields].sort() };
      const signature = toolShapeKey(shape);
      if (seen.has(signature)) continue;
      const plans = mappingPlans(shape);
      const candidates: ToolMapping[] = [];
      for (const candidate of (Array.isArray(raw.candidates) ? raw.candidates.slice(0, 8) : [])) {
        if (!object(candidate) || !object(candidate.fields) || typeof candidate.schema !== "string" || candidate.schema.length > 24_000) continue;
        const plan = plans.find((p) => p.name === candidate.name && JSON.stringify(Object.entries(p.fields).sort()) === JSON.stringify(Object.entries(candidate.fields as object).sort()));
        if (plan && !candidates.some((c) => c.name === plan.name)) candidates.push({ ...plan, schema: candidate.schema === plan.schema ? plan.schema : "outdated" });
      }
      if (!candidates.length) continue;
      const count = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1_000_000, Math.floor(v))) : 0;
      const target = candidates.find((c) => c.name === raw.target)?.name;
      const status = !imported && target && (raw.status === "manual" || raw.status === "learned" && count(raw.successes) >= 2) ? raw.status : "observed";
      const id = typeof raw.id === "string" && /^[a-z0-9-]{1,48}$/i.test(raw.id) ? raw.id : crypto.randomUUID();
      if (ids.has(id)) continue;
      rules.push({ id, shape, candidates, target,
        enabled: raw.enabled !== false, review: imported || raw.review === true || (candidates.length !== 1 || NEEDS_REVIEW.has(normalize(shape.name))) && status !== "manual",
        status, seen: count(raw.seen), successes: imported ? 0 : count(raw.successes), failures: imported ? 0 : count(raw.failures),
        at: typeof raw.at === "number" && Number.isFinite(raw.at) ? Math.max(0, Math.min(Date.now(), raw.at)) : 0, revision: count(raw.revision) });
      seen.add(signature);
      ids.add(id);
    }
    result[key] = { ...(entry.mode === "off" || entry.mode === "observe" || entry.mode === "auto" ? { mode: entry.mode } : {}), rules };
  }
  return result;
}

export function changeToolRule(state: ToolLearning, id: string, action: "confirm" | "toggle" | "delete", target?: string): ToolLearning {
  return { ...state, rules: state.rules.flatMap((rule) => {
    if (rule.id !== id) return [rule];
    if (action === "delete") return [];
    if (action === "toggle") return [{ ...rule, enabled: !rule.enabled, revision: rule.revision + 1 }];
    const mapping = mappingPlans(rule.shape).find((p) => p.name === target && rule.candidates.some((c) => c.name === p.name));
    if (!mapping) return [rule];
    return [{ ...rule, candidates: rule.candidates.map((c) => c.name === mapping.name ? mapping : c), target: mapping.name, enabled: true, review: false, status: "manual", successes: 0, failures: 0, revision: rule.revision + 1 }];
  }) };
}

type Choice = { content?: string | null; tool_calls?: ToolCall[] };
export type ToolLearningBridge = {
  resolve: (choice: Choice) => { calls?: ToolCall[]; error?: string } | undefined;
  before: (call: ToolCall) => string | undefined;
  after: (call: ToolCall, result: Record<string, unknown>) => void;
};
type Ticket = { id: string; revision: number; mapping: ToolMapping; names: string[] };

/** One session per normal agent job. No probe requests, model switching or global alias map. */
export class ToolLearningSession implements ToolLearningBridge {
  private readonly getState: () => ToolLearning;
  private readonly update: (fn: (state: ToolLearning) => ToolLearning) => void;
  private readonly contract: () => ToolContract;
  private readonly compatibility: ToolCompatibility;
  private readonly de: boolean;
  private readonly tickets = new WeakMap<ToolCall, Ticket>();
  private readonly succeeded = new Set<string>();
  constructor(opts: { get: () => ToolLearning; update: (fn: (state: ToolLearning) => ToolLearning) => void; contract: () => ToolContract; compatibility: ToolCompatibility; locale?: string }) {
    this.getState = opts.get; this.update = opts.update; this.contract = opts.contract; this.compatibility = opts.compatibility; this.de = opts.locale !== "en";
  }
  private get mode() { return toolLearningMode(this.getState().mode, this.compatibility); }
  private issue(name: string, why: "review" | "disabled" | "unavailable" | "limit") {
    if (why === "limit") return this.de ? "Lernspeicher für dieses Modell voll. In Einstellungen → Agent → Gelernte Tool-Aufrufe eine Regel löschen."
      : "Learning storage for this model is full. Delete a rule in Settings → Agent → Learned tool calls.";
    return this.de ? why === "review" ? `Tool-Zuordnung für „${name}“ in Einstellungen → Agent → Gelernte Tool-Aufrufe bestätigen.`
      : why === "disabled" ? `Tool-Übersetzung für „${name}“ ist deaktiviert oder wurde geändert.` : `Tool „${name}“ ist in dieser Anfrage nicht verfügbar.`
      : why === "review" ? `Confirm the mapping for "${name}" in Settings → Agent → Learned tool calls.`
        : why === "disabled" ? `Tool translation for "${name}" is disabled or has changed.` : `Tool "${name}" is not available on this request.`;
  }
  private record(observed: Observation): ToolRule | undefined {
    const key = toolShapeKey(observed.shape);
    this.update((state) => {
      const old = state.rules.find((r) => toolShapeKey(r.shape) === key);
      if (old && !old.enabled) return state;
      const changed = old && candidatesKey(old.candidates) !== candidatesKey(observed.candidates);
      const review = !!changed || observed.candidates.length !== 1 || NEEDS_REVIEW.has(normalize(observed.shape.name));
      const next: ToolRule = old && !changed ? { ...old, seen: Math.min(old.seen + 1, 1_000_000), at: Date.now() } : {
        id: old?.id || crypto.randomUUID(), shape: observed.shape, candidates: observed.candidates,
        target: observed.candidates.length === 1 ? observed.candidates[0].name : undefined,
        enabled: true, review, status: "observed", seen: (old?.seen || 0) + 1, successes: 0, failures: 0,
        at: Date.now(), revision: (old?.revision || 0) + 1,
      };
      const rules = state.rules.filter((r) => r.id !== old?.id);
      if (rules.length >= LEARNING_LIMITS.rules) {
        const removable = rules.findIndex((r) => r.enabled && r.status !== "manual");
        if (removable < 0) return state; // Keep explicit confirmations and disabled rules.
        rules.splice(removable, 1);
      }
      return { ...state, rules: [...rules, next] };
    });
    return this.getState().rules.find((r) => toolShapeKey(r.shape) === key);
  }
  resolve(choice: Choice): { calls?: ToolCall[]; error?: string } | undefined {
    if (this.mode === "off") return;
    const contract = this.contract();
    const observations: Observation[] = [];
    let calls = choice.tool_calls || [];
    if (contract.transport === "text") {
      if (parseTextTool(choice.content || "", contract.names).calls.length) return;
      const found = observeToolText(choice.content || "");
      if (!found) return;
      observations.push(found); calls = [found.call];
    } else {
      for (const call of calls) {
        if (!validateToolCall(call, [...TOOLS.keys()]).error || call.function.arguments.length > LEARNING_LIMITS.input) continue;
        try {
          const found = observation(call.function.name, JSON.parse(call.function.arguments), "native", "native", call);
          if (found) observations.push(found);
        } catch { /* malformed JSON is never repaired */ }
      }
    }
    if (!observations.length) return;
    const replacements = new Map<ToolCall, ToolCall>();
    let error: string | undefined;
    for (const observed of observations) {
      const rule = this.record(observed);
      if (this.mode !== "auto") continue;
      if (!rule) { error ||= this.issue(observed.shape.name, "limit"); continue; }
      if (!rule.enabled) { error ||= this.issue(observed.shape.name, "disabled"); continue; }
      const mapping = observed.candidates.find((c) => c.name === rule.target);
      if (!mapping || rule.review) { error ||= this.issue(observed.shape.name, "review"); continue; }
      if (!contract.names.includes(mapping.name)) { error ||= this.issue(mapping.name, "unavailable"); continue; }
      const call = translate(observed.call, observed.args, mapping);
      this.tickets.set(call, { id: rule.id, revision: rule.revision, mapping, names: [...contract.names] });
      replacements.set(observed.call, call);
    }
    if (error) return { error }; // Validate the entire proposed batch before executing any translation.
    return replacements.size ? { calls: calls.map((call) => replacements.get(call) || call) } : undefined;
  }
  before(call: ToolCall): string | undefined {
    const ticket = this.tickets.get(call);
    if (!ticket) return;
    const rule = this.getState().rules.find((r) => r.id === ticket.id);
    if (this.mode !== "auto" || !rule?.enabled || rule.review || rule.revision !== ticket.revision || rule.target !== ticket.mapping.name ||
      !rule.candidates.some((c) => mappingKey(c) === mappingKey(ticket.mapping)) || TOOLS.get(ticket.mapping.name)?.parameters && JSON.stringify(TOOLS.get(ticket.mapping.name)!.parameters) !== ticket.mapping.schema) return this.issue(call.function.name, "disabled");
    return validateToolCall(call, ticket.names).error;
  }
  after(call: ToolCall, result: Record<string, unknown>) {
    const ticket = this.tickets.get(call);
    if (!ticket || this.before(call) || result.already_executed || result.running || result.pending || result.truncated) return;
    const success = !result.error && result.ok !== false;
    if (success && this.succeeded.has(ticket.id)) return;
    if (success) this.succeeded.add(ticket.id);
    this.update((state) => ({ ...state, rules: state.rules.map((rule) => {
      if (rule.id !== ticket.id || rule.revision !== ticket.revision) return rule;
      const successes = rule.successes + (success ? 1 : 0);
      return { ...rule, successes, failures: rule.failures + (success ? 0 : 1), status: rule.status === "manual" ? "manual" : successes >= 2 ? "learned" : "observed" };
    }) }));
  }
}
