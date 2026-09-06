import { useEffect, useRef, useState } from "react";
import { Play, Pause, Square, SquareArrowOutUpRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type PreviewView, previewFor } from "@/lib/preview-doc";
import { cn } from "@/lib/cn";
import { runFile } from "@/lib/run-client";
import { closeRunWindow, dockRunWindow, fileForRun, openRunWindow, pickRunPreview } from "@/lib/run-window";
import { useIde } from "@/store/ide";
import { registerCanvasFrame } from "@/lib/canvas/session";
import { canvasScope } from "@/lib/canvas/scope";
import type { CanvasReply } from "@/lib/canvas/protocol";
import { nativeHelper } from "@/lib/helper-local";

export function PreviewPane({ popout = false }: { popout?: boolean }) {
  const path = useIde((s) => pickRunPreview(s.files, s.runPath, s.activePath, popout));
  const files = useIde((s) => s.files);
  const src = path ? files[path] ?? "" : "";
  const last = useIde((s) => {
    const p = pickRunPreview(s.files, s.runPath, s.activePath, popout);
    if (!p) return undefined;
    for (let i = s.output.length - 1; i >= 0; i--) if (s.output[i].label === p) return s.output[i];
    return undefined;
  });
  const running = useIde((s) => s.running);
  const setPreviewOpen = useIde((s) => s.setPreviewOpen);
  const inputMap = useIde((s) => s.inputMap);
  const runHtml = useIde((s) => s.runHtml);
  const scope = useIde(canvasScope);
  const [resolved, setResolved] = useState<{ path: string; view: PreviewView | null }>({ path: "", view: null });
  const view = resolved.path === path ? resolved.view : null;
  useEffect(() => {
    let canceled = false;
    if (!path) { setResolved({ path: "", view: null }); return; }
    void previewFor(path, src, files, last, inputMap, runHtml).then(
      value => { if (!canceled) setResolved({ path, view: value }); },
      error => { if (!canceled) setResolved({ path, view: { kind: "console", ok: false, label: path, stdout: "", stderr: error instanceof Error ? error.message : String(error) } }); },
    );
    return () => { canceled = true; };
  }, [path, src, files, last, inputMap, runHtml]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted">
          {popout ? "Run" : "Vorschau"}
          {path ? ` · ${path}` : ""}
          {view?.kind === "iframe" ? ` · ${view.label}` : ""}
        </span>
        <Button
          variant="quiet"
          className="h-7 px-2 text-xs"
          disabled={running}
          onClick={() => {
            if (popout) {
              const st = useIde.getState();
              const p = fileForRun();
              if (!p) return;
              st.setRunPath(p);
              st.setRunning(true);
              void runFile(p, st.files)
                .then((r) => st.pushOutput(r))
                .finally(() => st.setRunning(false));
              return;
            }
            window.dispatchEvent(new Event("anvil-run"));
          }}
        >
          <Play className="size-3" />
          Run
        </Button>
        {popout ? (
          <>
            <Button variant="quiet" className="h-7 px-2 text-xs" onClick={() => dockRunWindow()} title="Zurück in den Editor">
              Andocken
            </Button>
            <Button variant="quiet" className="h-7 w-7 p-0" aria-label="Fenster schließen" title="Fenster schließen" onClick={() => closeRunWindow()}>
              <X className="size-3.5" />
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="quiet"
              className="h-7 w-7 p-0"
              title="Eigenes Fenster"
              aria-label="Run-Fenster"
              onClick={() => openRunWindow()}
            >
              <SquareArrowOutUpRight className="size-3.5" />
            </Button>
            <Button variant="quiet" className="h-7 w-7 p-0" aria-label="Vorschau schließen" title="Vorschau schließen" onClick={() => setPreviewOpen(false)}>
              <X className="size-3.5" />
            </Button>
          </>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!path || !view ? (
          <p className="p-3 text-sm text-muted">Keine Datei.</p>
        ) : view.kind === "md" ? (
          <div
            className="preview-md min-h-0 flex-1 overflow-auto px-4 py-3 text-sm leading-6 text-fg"
            dangerouslySetInnerHTML={{ __html: view.html }}
          />
        ) : view.kind === "json" ? (
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {view.cols && view.rows ? (
              <table className="mb-3 w-full border-collapse text-left font-mono text-[11px]">
                <thead>
                  <tr>
                    {view.cols.map((c) => (
                      <th key={c} className="border-b border-border px-1.5 py-1 text-muted font-medium">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((r, i) => (
                    <tr key={i}>
                      {r.map((c, j) => (
                        <td key={j} className="border-b border-border/60 px-1.5 py-0.5 text-fg">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            <pre className="font-mono text-xs text-fg whitespace-pre-wrap">{view.text}</pre>
          </div>
        ) : view.kind === "iframe" ? (
          <GameFrame key={scope + ":" + path} srcDoc={view.srcDoc} scope={scope} popout={popout} />
        ) : view.kind === "console" ? (
          <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-5">
            <p className={cn("mb-2 tabular-nums", view.ok ? "text-ok" : "text-danger")}>
              {view.ok ? "ok" : "fehler"} · {view.label}
              {view.duration != null ? ` · ${view.duration.toFixed(2)}s` : ""}
            </p>
            {view.stdout ? <pre className="whitespace-pre-wrap text-fg">{view.stdout}</pre> : null}
            {view.stderr ? <pre className="mt-2 whitespace-pre-wrap text-danger">{view.stderr}</pre> : null}
          </div>
        ) : (
          <p className="p-3 text-sm text-muted text-pretty">{view.hint}</p>
        )}
      </div>
    </div>
  );
}

function GameFrame({ srcDoc, scope, popout }: { srcDoc: string; scope: string; popout: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const owner = useRef<ReturnType<typeof registerCanvasFrame> | null>(null);
  const [state, setState] = useState<CanvasReply | null>(null);
  const source = useRef(srcDoc);
  source.current = srcDoc;
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const capture = nativeHelper()?.canvasCapture;
    const registered = registerCanvasFrame(frame, { scope, priority: popout ? 2 : 1, capture,
      onState(reply) {
        setState(reply);
        if (reply.state === "failed") {
          const st = useIde.getState();
          if (st.output.some(o => o.stage?.kind === "html" && o.stage.id === reply.session && o.ok)) {
            useIde.setState({ output: st.output.map(o => o.stage?.kind === "html" && o.stage.id === reply.session ? { ...o, ok: false, stderr: reply.error || "Canvas-Laufzeitfehler", stage: { ...o.stage, state: "failed" } } : o) });
          }
        }
      }
    });
    owner.current = registered;
    void registered.load(source.current).catch(() => undefined);
    return () => { registered.dispose(); owner.current = null; };
  }, [scope, popout]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void owner.current?.load(srcDoc).catch(() => undefined); }, 150);
    return () => window.clearTimeout(timer);
  }, [srcDoc, scope, popout]);
  const labels = { loading: "Lädt…", ready: "Bereit", running: "Läuft", paused: "Pausiert", stopped: "Gestoppt", failed: "Fehler", disposed: "Beendet" };
  const control = (op: "pause" | "stop", args = {}) => {
    void owner.current?.command(op, args).catch(error => setState(current => current ? { ...current, ok: false, state: "failed", error: String(error.message || error) } : null));
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <div className="flex shrink-0 items-center gap-2 px-2 py-1 text-[11px] text-subtle">
        <span role="status" className={cn("flex-1", state?.state === "failed" && "text-danger")}>{state ? labels[state.state] : "Lädt…"}</span>
        <Button variant="quiet" className="h-6 px-2 text-xs" disabled={!state || !["running", "paused"].includes(state.state)} onClick={() => control("pause", { paused: state?.state !== "paused" })}>
          {state?.state === "paused" ? <Play className="size-3" /> : <Pause className="size-3" />}{state?.state === "paused" ? "Weiter" : "Pause"}
        </Button>
        <Button variant="quiet" className="h-6 px-2 text-xs" disabled={!state || ["stopped", "disposed"].includes(state.state)} onClick={() => control("stop")}><Square className="size-3" />Stop</Button>
      </div>
      {state?.error ? <pre role="alert" className="max-h-28 shrink-0 overflow-auto border-b border-border px-2 py-1 text-xs whitespace-pre-wrap text-danger">{state.error}</pre> : null}
      <iframe ref={ref} title="Vorschau" tabIndex={0} sandbox="allow-scripts allow-pointer-lock allow-forms allow-modals allow-downloads" className="min-h-0 w-full flex-1 bg-bg" />
    </div>
  );
}
