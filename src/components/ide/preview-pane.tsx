import { useEffect, useMemo, useRef } from "react";
import { Play, SquareArrowOutUpRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { langFromPath } from "@/lib/languages";
import { previewFor } from "@/lib/preview-doc";
import { cn } from "@/lib/cn";
import { runFile } from "@/lib/run-client";
import { closeRunWindow, dockRunWindow, fileForRun, openRunWindow, pickRunPreview } from "@/lib/run-window";
import { useIde } from "@/store/ide";

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
  const lang = path ? langFromPath(path) : "plaintext";
  const view = useMemo(
    () => (path ? previewFor(path, src, files, last, inputMap) : null),
    [path, src, files, last, inputMap],
  );

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
          <GameFrame srcDoc={view.srcDoc} frozen={!view.live} />
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

function GameFrame({ srcDoc, frozen }: { srcDoc: string; frozen: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const shown = useRef("");
  const hold = useRef(0);

  useEffect(() => {
    if (!srcDoc || shown.current === srcDoc) return;
    const wait = shown.current ? (Date.now() < hold.current ? hold.current - Date.now() : 400) : 0;
    const t = window.setTimeout(() => {
      if (shown.current === srcDoc) return;
      shown.current = srcDoc;
      const el = ref.current;
      if (el) el.srcdoc = srcDoc;
    }, Math.max(0, wait));
    return () => window.clearTimeout(t);
  }, [srcDoc]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <p className="shrink-0 px-2 py-1 text-[11px] text-subtle">
        {frozen ? "Letzter Lauf. Play startet neu." : "Live — nach Klick kurz nicht neu laden."}
      </p>
      <iframe
        ref={ref}
        title="Vorschau"
        tabIndex={0}
        sandbox="allow-scripts allow-pointer-lock allow-forms allow-modals allow-downloads"
        className="min-h-0 w-full flex-1 bg-bg"
        onMouseDown={() => {
          hold.current = Date.now() + 60000;
          ref.current?.focus();
        }}
        onLoad={() => {
          try {
            ref.current?.contentWindow?.focus();
          } catch {
            /* */
          }
        }}
      />
    </div>
  );
}
