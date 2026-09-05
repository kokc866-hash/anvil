let ctrl = new AbortController();
let why = "";
let gen = 0;
let beat = 0;

export function agentBeat(): void {
  beat += 1;
}

export function agentBeatN(): number {
  return beat;
}

export function beginAgent(): number {
  try {
    if (!ctrl.signal.aborted) ctrl.abort("replaced");
  } catch {
    /* */
  }
  ctrl = new AbortController();
  why = "";
  gen += 1;
  beat += 1;
  return gen;
}

export function agentGen(): number {
  return gen;
}

export function abortAgent(reason = "Abgebrochen"): void {
  why = reason;
  gen += 1;
  try {
    ctrl.abort(reason);
  } catch {
    ctrl.abort();
  }
}

export function agentAborted(): boolean {
  return ctrl.signal.aborted;
}

export function abortReason(): string {
  if (why) return why;
  const r = ctrl.signal.reason;
  if (typeof r === "string" && r.trim()) return r;
  if (r instanceof Error && r.message) return r.message;
  return "";
}

export class AgentAbortError extends Error {
  constructor(msg = "Abgebrochen") {
    super(msg);
    this.name = "AgentAbortError";
  }
}

export function isAbortLike(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof AgentAbortError) return true;
  if (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError") return true;
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err);
  return name === "AbortError" || /abort|aborted|AbortError|The operation was aborted|signal is aborted/i.test(msg);
}

export function explainAbort(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const r = abortReason();
  if (r) return r;
  if (/timeout|TimeoutError|Zeitüberschreitung/i.test(msg)) return msg;
  if (/signal is aborted without reason/i.test(msg)) {
    return "Abgebrochen. Stop, Zeitlimit oder Verbindung weg. Nochmal senden.";
  }
  return msg || "Abgebrochen";
}

export function explainLlmError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  let msg = raw;
  const json = raw.match(/\{[\s\S]*\}/);
  if (json) {
    try {
      const j = JSON.parse(json[0]) as { error?: { message?: string } | string; message?: string; detail?: string };
      const m = typeof j.error === "object" ? j.error?.message : j.error || j.message || j.detail;
      if (m) msg = String(m);
    } catch {
      const quoted = raw.match(/"message"\s*:\s*"((?:\\.|[^"\\])*)"/);
      if (quoted) {
        try {
          msg = JSON.parse(`"${quoted[1]}"`) as string;
        } catch {
          msg = quoted[1];
        }
      }
    }
  }
  if (/credit balance is too low|insufficient.?credit|billing/i.test(msg)) {
    return "Kein Guthaben beim Anbieter. Plans & Billing prüfen, dann nochmal senden.";
  }
  if (/401|invalid.?api.?key|unauthorized|authentication/i.test(msg)) return "API-Key ungültig oder fehlt.";
  if (/429|rate.?limit/i.test(msg)) return "Zu viele Anfragen. Kurz warten, dann nochmal.";
  return msg.replace(/^HTTP \d+:\s*/, "").slice(0, 420);
}

export function throwIfAborted(): void {
  if (ctrl.signal.aborted) throw new AgentAbortError(abortReason() || "Abgebrochen");
}

export function stopAgent(reason = "Gestoppt"): void {
  abortAgent(reason);
  void import("./app-log").then((m) => m.appLog("stop", reason));
  void import("@/store/ide").then(({ useIde }) => {
    const st = useIde.getState();
    st.setAgentBusy(false);
    st.failRunningSteps();
    st.setTestsRunning(false);
    st.setNotice(reason);
    if (st.agentJob) st.setAgentJob(null);
    void import("./companion-life").then((m) => m.releaseCompanion()).catch(() => undefined);
  });
  void import("./run-window").then((m) => m.releaseAgentUi());
}

export function hardStopMs(min = 0): number {
  if (!min || min <= 0) return 0;
  return Math.min(480, min) * 60_000;
}

/** Cloud/Abo: Slider 0 = kein Limit. Nie eine heimliche 3-Minuten-Kappe. */
export function cloudStopMs(min = 0): number {
  return hardStopMs(min);
}

/** Tot-Stream, nicht Job-Limit: erste Bytes vs. Pause danach. */
export const SSE_FIRST_MS = 25_000;
export const SSE_IDLE_MS = 90_000;
/** Kept for tests / docs. Local no longer uses these as a hidden cap. */
export const SSE_FIRST_LOCAL_MS = 600_000;
export const SSE_IDLE_LOCAL_MS = 180_000;

const LOCAL_LLM = new Set([
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
  "custom",
]);

export function isLocalLlm(provider: string): boolean {
  return LOCAL_LLM.has(String(provider || "").toLowerCase());
}

function privateUrlHost(baseUrl: string): boolean {
  const raw = String(baseUrl || "").trim();
  if (!raw) return true;
  try {
    const u = new URL(raw.includes("://") ? raw : `http://${raw}`);
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      h === "localhost" ||
      h === "0.0.0.0" ||
      h.endsWith(".localhost") ||
      h.endsWith(".local") ||
      h.endsWith(".internal") ||
      h.endsWith(".lan")
    ) {
      return true;
    }
    if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
    const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipv4) return false;
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  } catch {
    return true;
  }
}

/** Local runtimes always. Custom only on LAN/private URL — public custom uses cloud stall. */
export function localSseStall(provider: string, baseUrl = ""): boolean {
  const p = String(provider || "").toLowerCase();
  if (!isLocalLlm(p)) return false;
  if (p === "custom") return privateUrlHost(baseUrl);
  return true;
}

export function streamIdleMs(gotEvent: boolean, hardMin = 0, local = false): number {
  const hard = hardStopMs(hardMin);
  // Local + slider 0: never invent a 3/10-min cap. Prefill on 27B can sit silent
  // for minutes after the first SSE "role" chunk. Only the user slider stops it.
  if (local) return hard;
  const cap = gotEvent ? SSE_IDLE_MS : SSE_FIRST_MS;
  return hard > 0 ? Math.min(hard, cap) : cap;
}

/** Local complete: never retry a dead/empty stream — that aborts Ollama's in-flight load. */
export function shouldRetryLocalLlm(err: unknown): boolean {
  if (!err) return false;
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err);
  if (name === "StreamStallError") return false;
  if (/Leere Antwort|Leerer Stream|Kein Token/i.test(msg)) return false;
  return /Failed to fetch|network|ECONNRESET|hang|unload|HTTP 500|HTTP 502|HTTP 503/i.test(msg);
}

export function raceAbort<T>(p: Promise<T>, ms = 0): Promise<T> {
  throwIfAborted();
  const signal = ctrl.signal;
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      fn();
    };
    const onAbort = () => finish(() => reject(new AgentAbortError(abortReason() || "Gestoppt")));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    const timer =
      ms > 0
        ? globalThis.setTimeout(() => {
            finish(() => reject(new AgentAbortError(`Keine Antwort seit ${Math.round(ms / 1000)}s. Stop oder nochmal.`)));
          }, ms)
        : 0;
    p.then(
      (v) =>
        finish(() => {
          if (timer) globalThis.clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          resolve(v);
        }),
      (e) =>
        finish(() => {
          if (timer) globalThis.clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          reject(e);
        }),
    );
  });
}

export function withAgentTimeout(ms: number): AbortSignal {
  const c = new AbortController();
  const fire = (reason: unknown) => {
    if (c.signal.aborted) return;
    try {
      c.abort(reason);
    } catch {
      c.abort();
    }
  };
  if (ctrl.signal.aborted) {
    fire(ctrl.signal.reason || why || "Abgebrochen");
    return c.signal;
  }
  const timer =
    ms > 0
      ? globalThis.setTimeout(() => {
          fire(new DOMException(`Zeitüberschreitung nach ${Math.round(ms / 1000)}s`, "TimeoutError"));
        }, ms)
      : 0;
  const onParent = () => {
    if (timer) globalThis.clearTimeout(timer);
    fire(ctrl.signal.reason || why || "Abgebrochen");
  };
  ctrl.signal.addEventListener("abort", onParent, { once: true });
  c.signal.addEventListener(
    "abort",
    () => {
      if (timer) globalThis.clearTimeout(timer);
      ctrl.signal.removeEventListener("abort", onParent);
    },
    { once: true },
  );
  return c.signal;
}
