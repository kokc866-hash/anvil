import { useIde } from "@/store/ide";
type Reply = { hits?: unknown; checked?: unknown; value?: unknown; local?: unknown };
let worker: Worker | null = null;
let filesBefore: Record<string, string> = {};
let scope = -1, id = 0;
const pending = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
export function stopCompilerWorker(): void {
  worker?.terminate(); worker = null; filesBefore = {}; scope = -1;
  for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new Error("Sprachdienst neu gestartet.")); }
  pending.clear();
}
export function compilerJob(method: "lint" | "hover" | "definition" | "rename", files: Record<string, string>, open: string[], args: Record<string, unknown> = {}): Promise<Reply> {
  if (!worker) {
    worker = new Worker(new URL("./compiler-worker.ts", import.meta.url), { type: "module" });
    worker.onerror = () => stopCompilerWorker();
    worker.onmessage = ({ data }) => {
      const job = pending.get(data.id); if (!job) return;
      clearTimeout(job.timer); pending.delete(data.id);
      if (data.error) job.reject(new Error(data.error)); else job.resolve(data);
    };
  }
  const epoch = useIde.getState().workspaceEpoch;
  const reset = epoch !== scope;
  const changes: Record<string, string | null> = {};
  for (const [p, c] of Object.entries(files)) if (reset || filesBefore[p] !== c) changes[p] = c;
  if (!reset) for (const p of Object.keys(filesBefore)) if (!(p in files)) changes[p] = null;
  filesBefore = files; scope = epoch;
  const jobId = ++id;
  return new Promise((resolve, reject) => {
    pending.set(jobId, { resolve, reject, timer: setTimeout(() => stopCompilerWorker(), 30000) });
    worker!.postMessage({ id: jobId, method, args, changes, reset, open });
  });
}
