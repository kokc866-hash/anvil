import { agentGen, AgentAbortError, withAgentTimeout } from "./agent-abort.ts";

/** One request owns one generation and signal, even after a subsequent beginAgent. */
export type AgentRun = Readonly<{
  generation: number;
  signal: AbortSignal;
  current: () => boolean;
  assertCurrent: () => void;
  timeout: (ms: number) => AbortSignal;
  wait: <T>(pending: Promise<T>, ms?: number) => Promise<T>;
}>;

export function captureAgentRun(valid: () => boolean = () => true, signal: AbortSignal = withAgentTimeout(0)): AgentRun {
  const generation = agentGen();
  const current = () => generation === agentGen() && !signal.aborted && valid();
  const assertCurrent = () => {
    if (current()) return;
    const reason = signal.reason;
    throw new AgentAbortError(typeof reason === "string" ? reason : reason instanceof Error ? reason.message : "Anfrage oder Projekt ersetzt");
  };
  const timeout = (ms: number) => ms > 0 ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : signal;
  const wait = async <T>(pending: Promise<T>, ms = 0): Promise<T> => {
    assertCurrent();
    const abort = timeout(ms);
    let stop: () => void = () => {};
    try {
      const result = await Promise.race([pending, new Promise<never>((_, reject) => {
        stop = () => reject(new AgentAbortError(abort.reason instanceof Error ? abort.reason.message : String(abort.reason || "Abgebrochen")));
        if (abort.aborted) stop(); else abort.addEventListener("abort", stop, { once: true });
      })]);
      assertCurrent();
      return result;
    } finally { abort.removeEventListener("abort", stop); }
  };
  return Object.freeze({ generation, signal, current, assertCurrent, timeout, wait });
}

/** Guard both invocation and settlement without changing synchronous callback contracts. */
export function bindAgentRun<T extends object>(run: AgentRun, callbacks: T): T {
  return Object.fromEntries(Object.entries(callbacks).map(([key, value]) => [key, typeof value !== "function" ? value : (...args: unknown[]) => {
    run.assertCurrent();
    const result = value(...args);
    if (result && typeof result.then === "function") return Promise.resolve(result).then(output => { run.assertCurrent(); return output; });
    run.assertCurrent();
    return result;
  }])) as T;
}
