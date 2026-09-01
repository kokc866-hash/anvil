import { useState } from "react";
import { debugContinue, debugEval, debugStep, debugStop } from "@/lib/debug-engine";
import { Button } from "@/components/ui/button";
import { useIde } from "@/store/ide";

export function DebugPane() {
  const debug = useIde((s) => s.debug);
  const openFile = useIde((s) => s.openFile);
  const addWatch = useIde((s) => s.addWatch);
  const removeWatch = useIde((s) => s.removeWatch);
  const [expr, setExpr] = useState("");
  const [watch, setWatch] = useState("");

  async function runEval() {
    const e = expr.trim();
    if (!e) return;
    const v = await debugEval(e);
    useIde.getState().setDebugEval(`${e} → ${v}`);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto px-2 py-2 text-xs">
      <div className="mb-2 flex items-center gap-1">
        <Button className="h-7 text-[11px]" disabled={!debug.paused} onClick={() => debugContinue()}>
          Weiter
        </Button>
        <Button className="h-7 text-[11px]" disabled={!debug.paused} onClick={() => debugStep()}>
          Step
        </Button>
        <Button className="h-7 text-[11px]" variant="danger" disabled={!debug.active} onClick={() => debugStop()}>
          Stop
        </Button>
        <Button
          className="h-7 text-[11px]"
          disabled={!debug.paused}
          onClick={() => void import("@/lib/fix-agent").then((m) => m.askDebug())}
        >
          Agent
        </Button>
        <span className="ml-1 truncate text-muted">
          {debug.paused && debug.path ? `${debug.path}:${debug.line} · ${debug.reason || "pause"}` : debug.active ? "läuft…" : "bereit"}
        </span>
      </div>

      <p className="mb-1 font-medium tracking-wide text-subtle uppercase">Stack</p>
      {debug.stack.length === 0 ? (
        <p className="mb-2 text-muted">—</p>
      ) : (
        <ul className="mb-2">
          {debug.stack.map((f, i) => (
            <li key={`${f.path}:${f.line}:${i}`}>
              <button
                type="button"
                className="w-full truncate rounded-md px-1 py-0.5 text-left font-mono text-muted hover:bg-hover hover:text-fg"
                onClick={() => openFile(f.path)}
              >
                {f.fn} · {f.path}:{f.line}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="mb-1 font-medium tracking-wide text-subtle uppercase">Locals</p>
      {Object.keys(debug.locals).length === 0 ? (
        <p className="mb-2 text-muted">—</p>
      ) : (
        <ul className="mb-2 font-mono">
          {Object.entries(debug.locals).map(([k, v]) => (
            <li key={k} className="flex gap-2 px-1 py-0.5">
              <span className="text-fg">{k}</span>
              <span className="min-w-0 truncate text-muted">{v}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mb-1 font-medium tracking-wide text-subtle uppercase">Watch</p>
      <form
        className="mb-1 flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          addWatch(watch);
          setWatch("");
        }}
      >
        <input
          value={watch}
          placeholder="Ausdruck"
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 font-mono text-fg outline-none"
          onChange={(e) => setWatch(e.target.value)}
        />
        <Button className="h-7 text-[11px]" type="submit">
          +
        </Button>
      </form>
      <ul className="mb-2 font-mono">
        {debug.watches.map((w) => (
          <li key={w} className="flex items-center gap-2 px-1 py-0.5">
            <span className="text-fg">{w}</span>
            <span className="min-w-0 flex-1 truncate text-muted">{debug.watchValues[w] ?? "—"}</span>
            <button type="button" className="text-subtle hover:text-fg" onClick={() => removeWatch(w)}>
              ×
            </button>
          </li>
        ))}
      </ul>

      <p className="mb-1 font-medium tracking-wide text-subtle uppercase">Debug-Konsole</p>
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          void runEval();
        }}
      >
        <input
          value={expr}
          placeholder={debug.paused ? "x + 1" : "Pause für Eval"}
          disabled={!debug.paused}
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 font-mono text-fg outline-none disabled:opacity-50"
          onChange={(e) => setExpr(e.target.value)}
        />
        <Button className="h-7 text-[11px]" type="submit" disabled={!debug.paused}>
          Eval
        </Button>
      </form>
      {debug.lastEval ? <pre className="mt-1 whitespace-pre-wrap font-mono text-muted">{debug.lastEval}</pre> : null}
    </div>
  );
}
