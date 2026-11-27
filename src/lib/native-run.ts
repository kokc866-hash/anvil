import { useIde, type RunResult } from "@/store/ide";
import { agentGen } from "./agent-abort";
import type { CompanionJob } from "./companion";

export type NativeRunScope = Readonly<{ epoch: number; cwd: string; companion: string; generation: number }>;
export type NativeRunObservation = CompanionJob | { requestId: string; pending: true };

/** Capture before the first await; resource observation outlives this UI target. */
export function captureNativeRunScope(): NativeRunScope {
  const st = useIde.getState();
  return { epoch: st.workspaceEpoch, cwd: st.workspaceCwd, companion: st.companionUrl, generation: agentGen() };
}

function current(scope: NativeRunScope): boolean {
  const st = useIde.getState();
  return st.workspaceEpoch === scope.epoch && st.workspaceCwd === scope.cwd && st.companionUrl === scope.companion && agentGen() === scope.generation;
}

export function reportUncertainNativeRun(scope: NativeRunScope, key: string, label: string, error: unknown): void {
  if (!current(scope)) return;
  const detail = error instanceof Error ? error.message : String(error);
  const st = useIde.getState();
  st.pushOutput({ ok: false, stdout: "", stderr: `Engine-Startstatus unbekannt. Das Prozessende ist nicht bestätigt; die Ressource bleibt gebunden.\n${detail.slice(0, 500)}`,
    duration: 0, label, stage: { kind: "log", id: key } });
  st.revealOutput();
}

const watches = new Map<string, () => void>();

/** Read-only polling never selects a Companion workspace or releases on timeout/404. */
export function watchNativeRun(options: {
  key: string; id?: string; scope: NativeRunScope; label?: string; recover?: boolean;
  read: () => Promise<NativeRunObservation>; release: () => Promise<void>;
}): () => void {
  if (watches.has(options.key)) return watches.get(options.key)!;
  let stopped = false, failures = 0, id = options.id;
  let timer: number | undefined;
  const stop = () => { stopped = true; if (timer !== undefined) window.clearTimeout(timer); watches.delete(options.key); };
  watches.set(options.key, stop);
  const update = (r: CompanionJob) => {
    if (!current(options.scope)) return;
    const matches = (value: string | undefined) => value !== undefined && (value === id || value === options.key);
    const result = (o: RunResult): RunResult => ({ ...o, ok: r.ok, stdout: r.stdout, stderr: r.stderr,
      duration: r.duration / 1000, stage: r.stage, ...(options.recover && options.label ? { label: options.label } : {}) });
    useIde.setState(st => {
      const output = st.output.map(o => matches(o.stage?.id) ? result(o) : o);
      // A known running process must remain discoverable even when its HTTP start reply was lost.
      if (options.recover && r.running && r.stage?.id && !output.some(o => o.stage?.id === r.stage?.id))
        output.push(result({ ok: r.ok, stdout: "", stderr: "", duration: 0, label: options.label || "Engine" }));
      return { output, chat: st.chat.map(c => matches(c.lastRun?.id) && c.lastRun ? { ...c, lastRun: { ...c.lastRun,
        id: r.stage?.id, ok: r.ok, stdout: r.stdout, stderr: r.stderr, running: r.running } } : c) };
    });
    id = r.stage?.id || id;
  };
  const poll = async () => {
    if (stopped) return;
    try {
      const r = await options.read();
      if (stopped) return;
      failures = 0;
      if (!("pending" in r && r.pending)) {
        const job = r as CompanionJob;
        update(job);
        if (job.running === false && !job.uncertain) { await options.release(); stop(); return; }
      }
    } catch {
      failures++;
      if (failures === 3 && current(options.scope)) {
        useIde.setState(st => ({ output: st.output.map(o => (id !== undefined && o.stage?.id === id) || o.stage?.id === options.key ? { ...o, ok: false,
          stderr: [o.stderr, "Run-Status nicht erreichbar. Das Prozessende ist nicht bestätigt; die Ressource bleibt gebunden."].filter(Boolean).join("\n") } : o) }));
      }
    }
    if (!stopped) timer = window.setTimeout(() => void poll(), Math.min(30000, 2000 * Math.max(1, failures)));
  };
  timer = window.setTimeout(() => void poll(), 1000);
  return stop;
}
