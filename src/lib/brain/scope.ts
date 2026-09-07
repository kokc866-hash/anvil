import { useIde } from "@/store/ide";
import { agentGen } from "../abort";
import { useBrain, type BrainJobs } from "./store";

const automaticJobs = new Set([
  "intent", "attach", "complete", "palette", "compact", "title", "distill", "usage",
  "followup", "review", "prompts", "diffs", "tabHint", "secrets", "mention", "planText",
]);
export const automaticBrainJob = (job: string) => automaticJobs.has(job.split(":")[0]);

export function brainJobAllowed(job: string, automatic = automaticBrainJob(job)): boolean {
  const s = useBrain.getState();
  return s.on && (!automatic || s.autonomy !== "off") && s.jobs[job.split(":")[0] as keyof BrainJobs] !== false;
}

const resetters = new Set<() => void>();
let bound = false;
let revision = 0;
const commits = new Map<string, number>();
export function onBrainScopeReset(fn: () => void) {
  resetters.add(fn);
  bindBrainScope();
  return () => { resetters.delete(fn); };
}

export function bindBrainScope() {
  if (bound) return;
  bound = true;
  const reset = () => {
    revision++;
    commits.clear();
    useBrain.setState({ prompts: [], followups: [], lane: [], lastAuto: "" });
    resetters.forEach((fn) => fn());
  };
  useIde.subscribe((s, p) => {
    if (s.workspaceEpoch !== p.workspaceEpoch || s.chat[0]?.id !== p.chat[0]?.id) reset();
  });
  useBrain.subscribe((s, p) => {
    if ((p.on && !s.on) || (s.autonomy === "off" && p.autonomy !== "off")) reset();
    else if (s.jobs !== p.jobs) {
      revision++;
      useBrain.setState({
        ...(s.jobs.prompts ? {} : { prompts: [] }),
        ...(s.jobs.followup ? {} : { followups: [] }),
        lane: [],
      });
      resetters.forEach((fn) => fn());
    }
  });
}

/** Recheck at every asynchronous commit, including heuristic fallbacks. */
export function captureBrainScope(job: string, automatic = automaticBrainJob(job)): () => boolean {
  bindBrainScope();
  const ide = useIde.getState();
  const epoch = ide.workspaceEpoch;
  const chat = ide.chat[0]?.id;
  const generation = agentGen();
  const settings = useBrain.getState();
  const capturedRevision = revision;
  return () => {
    const now = useIde.getState();
    const brain = useBrain.getState();
    return capturedRevision === revision && epoch === now.workspaceEpoch && chat === now.chat[0]?.id && generation === agentGen()
      && brainJobAllowed(job, automatic) && brain.modelId === settings.modelId
      && brain.customId === settings.customId && brain.systemExtra === settings.systemExtra;
  };
}

export function captureBrainCommit(job: string, key = job): () => boolean {
  const valid = captureBrainScope(job);
  const ticket = (commits.get(key) ?? 0) + 1;
  commits.set(key, ticket);
  return () => valid() && commits.get(key) === ticket;
}

export const brainCanceled = () => Object.assign(new Error("Helfer-Aufgabe nicht mehr aktuell"), { name: "AbortError" });
