export type HarnessPhase = "plan" | "act" | "observe" | "patch" | "see" | "engine" | "done" | "abort";

export type ObsKind = "write" | "edit" | "run" | "engine" | "see" | "play" | "test" | "read" | "mcp" | "other";

export type Observation = {
  kind: ObsKind;
  name: string;
  ok: boolean;
  path?: string;
  stdout?: string;
  stderr?: string;
  image?: boolean;
  graphical?: boolean;
};

export type HarnessBudget = {
  rounds: number;
  tools: number;
  runs: number;
  sees: number;
  patches: number;
};

export type HarnessState = {
  phase: HarnessPhase;
  budget: HarnessBudget;
  used: HarnessBudget;
  last?: Observation;
  history: Observation[];
  reason: string;
};

export type AfterWrite = "run" | "engine" | "preview" | "none";

export type HarnessOpts = {
  runLoop: boolean;
  graphLoop: boolean;
  loopTries: number;
  maxRounds?: number;
  maxTools?: number;
  afterWrite?: AfterWrite;
  graphSees?: number;
};

const EMPTY: HarnessBudget = { rounds: 0, tools: 0, runs: 0, sees: 0, patches: 0 };

const PHASE: Record<HarnessPhase, string> = {
  plan: "Plan",
  act: "Arbeit",
  observe: "Run",
  patch: "Patch",
  see: "Vorschau",
  engine: "Engine",
  done: "Fertig",
  abort: "Stop",
};

export function startHarness(opts: HarnessOpts): HarnessState {
  const tries = clamp(opts.loopTries ?? 3, 1, 5);
  return {
    phase: "plan",
    budget: {
      rounds: opts.maxRounds ?? 24,
      tools: opts.maxTools ?? 64,
      runs: opts.runLoop ? tries : 1,
      sees: opts.graphLoop ? clamp(opts.graphSees ?? 4, 0, 8) : 0,
      patches: opts.runLoop ? tries : 0,
    },
    used: { ...EMPTY },
    history: [],
    reason: "start",
  };
}

export function kindOfTool(name: string): ObsKind {
  if (name === "run_file") return "run";
  if (name === "shell") return "run";
  if (name.startsWith("engine_")) return "engine";
  if (name === "see_run") return "see";
  if (name === "play") return "play";
  if (name === "write_file" || name === "append_file") return "write";
  if (name === "edit_file") return "edit";
  if (name === "mcp_call") return "mcp";
  if (/read|list|grep|harness_read/.test(name)) return "read";
  return "other";
}

export function noteObs(state: HarnessState, obs: Observation): HarnessState {
  const used = { ...state.used, tools: state.used.tools + 1 };
  if (obs.kind === "run" || obs.kind === "test") used.runs += 1;
  if (obs.kind === "see" || obs.kind === "play") used.sees += 1;
  if ((obs.kind === "edit" || obs.kind === "write") && state.last && !state.last.ok) used.patches += 1;
  return { ...state, used, last: obs, history: [...state.history, obs].slice(-20) };
}

export type HarnessTick = {
  state: HarnessState;
  allow: string[];
  hint: string;
  stop: boolean;
};

export function stepHarness(state: HarnessState, opts: HarnessOpts): HarnessTick {
  if (state.phase === "abort" || state.phase === "done") {
    return { state, allow: [], hint: state.reason, stop: true };
  }

  if (state.used.tools >= state.budget.tools || state.used.rounds >= state.budget.rounds) {
    const next = { ...state, reason: "budget — core tools only" };
    return {
      state: next,
      allow: ["read_file", "edit_file", "append_file", "write_file", "run_file", "grep"],
      hint: "Budget full. Core tools only — finish the job, do not restart.",
      stop: false,
    };
  }

  const last = state.last;
  const runsLeft = state.budget.runs - state.used.runs;
  const seesLeft = state.budget.sees - state.used.sees;
  const patchesLeft = state.budget.patches - state.used.patches;

  if (!last) {
    const next = { ...state, phase: "act" as const, reason: "plan then tools" };
    return { state: next, allow: [], hint: "set_plan, then read/write.", stop: false };
  }

  if (!last.ok && (last.kind === "run" || last.kind === "engine" || last.kind === "test")) {
    if (patchesLeft <= 0 || runsLeft <= 0) {
      const next = { ...state, phase: "act" as const, reason: "run budget — continue without loop" };
      return { state: next, allow: ["read_file", "edit_file", "append_file", "write_file", "grep"], hint: next.reason, stop: false };
    }
    const next = { ...state, phase: "patch" as const, reason: "error — patch and run again" };
    return {
      state: next,
      allow: ["read_file", "edit_file", "write_file", "run_file", "engine_run", "grep"],
      hint: `Error. Patch + run_file/engine_run. ${Math.min(patchesLeft, runsLeft)} left.`,
      stop: false,
    };
  }

  if (opts.graphLoop && last.ok && last.graphical && last.kind !== "see" && last.kind !== "play" && seesLeft > 0) {
    const next = { ...state, phase: "see" as const, reason: "look at preview" };
    return {
      state: next,
      allow: ["see_run", "play", "edit_file", "run_file"],
      hint: "see_run or play, then say briefly what you see.",
      stop: false,
    };
  }

  if (last.kind === "write" || last.kind === "edit") {
    if (skipRun(last.path)) {
      const next = { ...state, phase: "act" as const, reason: "continue" };
      return { state: next, allow: [], hint: "", stop: false };
    }
    const mode = opts.afterWrite ?? (opts.runLoop ? "run" : "none");
    if (mode === "engine") {
      const next = { ...state, phase: "engine" as const, reason: "after write: engine" };
      return {
        state: next,
        allow: ["engine_run", "engine_status", "read_file"],
        hint: "engine_run via companion. No mini-engine.",
        stop: false,
      };
    }
    if (mode === "preview") {
      const next = { ...state, phase: "observe" as const, reason: "after write: preview" };
      return {
        state: next,
        allow: ["run_file", "see_run", "open_preview"],
        hint: "run_file, then see_run if HTML.",
        stop: false,
      };
    }
    if (mode !== "none" && opts.runLoop && runsLeft > 0) {
      const next = { ...state, phase: "observe" as const, reason: "after write: run" };
      return {
        state: next,
        allow: ["run_file", "engine_run", "open_preview"],
        hint: "run_file this round. Read the output.",
        stop: false,
      };
    }
  }

  const next = { ...state, phase: "act" as const, reason: "continue" };
  return { state: next, allow: [], hint: "", stop: false };
}

export function abortHarness(state: HarnessState): HarnessState {
  return { ...state, phase: "abort", reason: "Abgebrochen" };
}

export function harnessPrompt(tick: HarnessTick): string {
  if (tick.stop) return `Harness: stop. ${tick.hint}`.trim();
  if (!tick.hint) return "";
  const allow = tick.allow.length ? ` Allowed: ${tick.allow.join(", ")}.` : "";
  return `Harness (${tick.state.phase}): ${tick.hint}${allow}`;
}

export function harnessBar(state: HarnessState): string {
  const b = state.budget;
  const u = state.used;
  const bits = [`${PHASE[state.phase]}`];
  if (b.runs > 1 || u.runs > 0) bits.push(`Run ${u.runs}/${b.runs}`);
  if (b.sees > 0) bits.push(`See ${u.sees}/${b.sees}`);
  bits.push(`Tools ${u.tools}/${b.tools}`);
  return bits.join(" · ");
}

function skipRun(path?: string) {
  if (!path) return false;
  return path.startsWith(".anvil/") || /\.(md|json|txt|svg)$/i.test(path);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
