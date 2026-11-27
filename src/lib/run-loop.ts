import { runFile } from "./run-client";
import { withAgentTimeout } from "./abort";
import { captureAgentRun, type AgentRun } from "./agent-run";
import { useIde } from "@/store/ide";
import { canvasCommand, findCanvasFrame } from "./canvas/session";
import { canvasScope } from "./canvas/scope";
import type { CanvasReply } from "./canvas/protocol";
import { parsePlayInput, performPreviewInput, type PlayAction } from './preview-input';

export type LoopShot = Partial<CanvasReply> & { image: string | null; logs: string[];
  input?: { mode:string; completed:number; total:number; assertions?:number };
  previewPath?: string | null; previewMissingTarget?: string; rejected?: boolean; definitelyNotExecuted?: boolean };
let fails = 0;
export function resetLoopFails() {
  fails = 0;
}
export function noteLoopFail(ok: boolean, max: number) {
  if (ok) {
    fails = 0;
    return { left: max, again: false };
  }
  fails++;
  return { left: Math.max(0, max - fails), again: fails < max };
}
function signal() {
  return useIde.getState().agentBusy ? withAgentTimeout(0) : undefined;
}
export async function loadLoop(html: string): Promise<void> {
  const frame = await findCanvasFrame(canvasScope(useIde.getState()), 5000, signal());
  const r = await canvasCommand(frame, "load", { html, restart: true }, signal());
  if (!r.ok) throw new Error(r.error || "Canvas-Start fehlgeschlagen.");
}
export async function shotLoop(html?: string, expectedSession?: string, run?: AgentRun): Promise<LoopShot> {
  const abort = run?.signal ?? signal();
  try {
    run?.assertCurrent();
    const frame = await findCanvasFrame(canvasScope(useIde.getState()), 5000, abort);
    run?.assertCurrent();
    if (html) await canvasCommand(frame, "load", { html, restart: false }, abort);
    run?.assertCurrent();
    const shot = await canvasCommand(frame, "shot", { expectedSession }, abort);
    run?.assertCurrent();
    return { ...shot, image: shot.image || null };
  } catch (error) {
    return {
      ok: false,
      image: null,
      logs: [],
      error: error instanceof Error ? error.message : String(error),
      state: "failed",
    };
  }
}
export async function playLoop(keys: string[], holdMs = 90, run?: AgentRun, actions?: PlayAction[]): Promise<LoopShot> {
  const abort = run?.signal ?? signal();
  let previewPath: string | null = null;
  try {
    const input = parsePlayInput({keys,hold_ms:holdMs,actions});
    run?.assertCurrent();
    const frame = await findCanvasFrame(canvasScope(useIde.getState()), 1000, abort);
    run?.assertCurrent();
    const current = await canvasCommand(frame, "ready", {}, abort);
    run?.assertCurrent();
    if (!current.ok) throw new Error(current.error || "Programm ist nicht bereit.");
    const state = useIde.getState();
    const boundOutput = current.session && [...state.output].reverse().find(row => row.stage?.kind === "html" && row.stage.id === current.session);
    if (boundOutput && Object.hasOwn(state.files, boundOutput.label)) previewPath = boundOutput.label;
    const progress = await performPreviewInput(input,useIde.getState().inputMap,{
      current:()=>run?.assertCurrent(),
      assert:async action=>{
        const reply=await canvasCommand(frame,'assert',{action,expectedSession:current.session},abort);
        if(!reply.ok)throw new Error(reply.error||'Prüfung fehlgeschlagen.');
      },
      target:async (target,scroll)=>{
        const reply=await canvasCommand(frame,'target',{target,scroll,expectedSession:current.session},abort);
        if(!reply.ok || !reply.point)throw new Error(reply.error||'Vorschauziel nicht gefunden.');
        return reply.point;
      },
      event:async(event,release)=>{
        const reply=await canvasCommand(frame,release?'input-up':'input',{event,expectedSession:current.session},release?undefined:abort);
        if(!reply.ok)throw new Error(reply.error||'Eingabe konnte nicht zugestellt werden.');
      },
    },abort);
    const shot = await canvasCommand(frame, "shot", { expectedSession: current.session }, abort);
    run?.assertCurrent();
    return { ...shot, image: shot.image || null, previewPath, input:{mode:'dom-events',...progress} };
  } catch (error) {
    return {
      ok: false,
      image: null,
      logs: [],
      error: error instanceof Error ? error.message : String(error),
      previewPath,
      ...(error && typeof error === 'object' && 'previewMissingTarget' in error && typeof error.previewMissingTarget === 'string'
        ? { previewMissingTarget: error.previewMissingTarget, rejected: true, definitelyNotExecuted: true } : {}),
      input: error && typeof error==='object' && 'inputProgress' in error ? {mode:'dom-events',...(error.inputProgress as {completed:number;total:number})} : undefined,
    };
  }
}
export async function runLoopFile(
  path: string,
  files: Record<string, string>,
  opts?: { graph?: boolean; tries?: number; run?: AgentRun },
) {
  const epoch = useIde.getState().workspaceEpoch;
  const run = opts?.run ?? captureAgentRun(() => useIde.getState().workspaceEpoch === epoch);
  run.assertCurrent();
  const r = await runFile(path, files, { run });
  run.assertCurrent();
  const shot =
    opts?.graph !== false && r.html && r.ok
      ? await shotLoop(undefined, r.stage?.id, run)
      : ({ image: null, logs: [] } as LoopShot);
  const ok = r.ok && shot.state !== "failed";
  run.assertCurrent();
  const budget = noteLoopFail(ok, Math.min(5, Math.max(1, opts?.tries ?? 3)));
  return {
    ...r,
    ok,
    stdout: r.stdout.slice(0, 16000),
    stderr: (
      r.stderr ||
      (shot.state === "failed" ? shot.error : "") ||
      shot.logs.filter((l) => l.startsWith("error")).join("\n")
    ).slice(0, 16000),
    logs: shot.logs,
    observation: shot.observation ?? r.observation,
    capture_error: shot.ok === false && shot.state !== "failed" ? shot.error : undefined,
    graphical: Boolean(r.html),
    image: shot.image || undefined,
    size: shot.w && shot.h ? `${shot.w}×${shot.h}` : undefined,
    tries_left: budget.left,
    hint: ok
      ? undefined
      : budget.again
        ? "Error. Patch and run_file again."
        : "No tries left this round.",
  };
}
