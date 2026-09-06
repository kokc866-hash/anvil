import { runFile } from "./run-client";
import { throwIfAborted, withAgentTimeout } from "./abort";
import { useIde } from "@/store/ide";
import { canvasCommand, findCanvasFrame } from "./canvas/session";
import { canvasScope } from "./canvas/scope";
import type { CanvasReply } from "./canvas/protocol";

export type LoopShot = Partial<CanvasReply> & { image: string | null; logs: string[] };
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
export async function shotLoop(html?: string, expectedSession?: string): Promise<LoopShot> {
  try {
    const frame = await findCanvasFrame(canvasScope(useIde.getState()), 5000, signal());
    if (html) await canvasCommand(frame, "load", { html, restart: false }, signal());
    const shot = await canvasCommand(frame, "shot", { expectedSession }, signal());
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
function mapKeys(raw: string[]) {
  return raw
    .flatMap((key) => (key === " " ? [" "] : key.split(/[,\s]+/).filter(Boolean)))
    .slice(0, 24);
}
function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("Abgebrochen", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}
export async function playLoop(keys: string[], holdMs = 90): Promise<LoopShot> {
  const seq = mapKeys(keys),
    abort = signal();
  if (!seq.length) return { ok: false, image: null, logs: [], error: "Keine Tasten angegeben." };
  try {
    const frame = await findCanvasFrame(canvasScope(useIde.getState()), 1000, abort);
    const current = await canvasCommand(frame, "ready", {}, abort);
    if (!current.ok) throw new Error(current.error || "Programm ist nicht bereit.");
    for (const key of seq) {
      try {
        const reply = await canvasCommand(
          frame,
          "keys",
          { keys: [key], expectedSession: current.session },
          abort,
        );
        if (!reply.ok) throw new Error(reply.error || "Eingabe konnte nicht zugestellt werden.");
        await wait(Math.min(400, Math.max(40, holdMs)), abort);
      } finally {
        // Release even when Stop interrupts a held key. Never continue the sequence after abort.
        await canvasCommand(frame, "keys-up", {
          keys: [key],
          expectedSession: current.session,
        }).catch(() => undefined);
      }
      await wait(40, abort);
    }
    const shot = await canvasCommand(frame, "shot", { expectedSession: current.session }, abort);
    return { ...shot, image: shot.image || null };
  } catch (error) {
    return {
      ok: false,
      image: null,
      logs: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
export async function runLoopFile(
  path: string,
  files: Record<string, string>,
  opts?: { graph?: boolean; tries?: number },
) {
  throwIfAborted();
  const r = await runFile(path, files);
  const shot =
    opts?.graph !== false && r.html && r.ok
      ? await shotLoop(undefined, r.stage?.id)
      : ({ image: null, logs: [] } as LoopShot);
  const ok = r.ok && shot.state !== "failed";
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
