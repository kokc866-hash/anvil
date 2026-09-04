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

/** Cloud/Proxy: Slider 0 = kein hartes Limit. Trotzdem nicht ewig warten. */
export function cloudStopMs(min = 0): number {
  const n = hardStopMs(min);
  return n > 0 ? n : 180_000;
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
