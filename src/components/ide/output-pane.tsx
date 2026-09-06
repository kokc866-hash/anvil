import { useEffect, useRef, useState, type ComponentType } from "react";
import { PanelBottom, PanelRight, SquareArrowOutUpRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyBtn } from "@/components/ui/copy-btn";
import { mergeTests, testsPrompt, discoverTests } from "@/lib/test-parse";
import { problemsPrompt } from "@/lib/lsp";
import { evalSnippet } from "@/lib/run-client";
import { runAllTests } from "@/lib/run-tests";
import { parseTestCommand, runAgentShell } from "@/lib/agent-shell";
import { closeOutputWindow, openOutputWindow } from "@/lib/output-window";
import { cn } from "@/lib/cn";
import { gotoFile } from "@/lib/goto";
import { useIde } from "@/store/ide";
import { useT } from "@/lib/i18n";
import { DebugPane } from "./debug-pane";
import { LogText } from "./log-text";
import { HelperPrompts } from "./helper-prompts";

export function OutputPane({ popout = false }: { popout?: boolean }) {
  const t = useT();
  const output = useIde((s) => s.output);
  const clearOutput = useIde((s) => s.clearOutput);
  const togglePanel = useIde((s) => s.togglePanel);
  const openFile = useIde((s) => s.openFile);
  const files = useIde((s) => s.files);
  const activePath = useIde((s) => s.activePath);
  const pushOutput = useIde((s) => s.pushOutput);
  const outputDock = useIde((s) => s.outputDock);
  const setOutputDock = useIde((s) => s.setOutputDock);
  const debug = useIde((s) => s.debug);
  const pluginProblems = useIde((s) => s.pluginProblems);
  const lspProblems = useIde((s) => s.lspProblems);
  const testResults = useIde((s) => s.testResults);
  const [tab, setTab] = useState<"out" | "prob" | "dbg" | "test" | "term">("out");
  const [Term, setTerm] = useState<ComponentType | null>(null);
  useEffect(() => {
    function onProb() {
      setTab("prob");
    }
    function onDbg() {
      setTab("dbg");
    }
    window.addEventListener("anvil-problems", onProb);
    window.addEventListener("anvil-debug-tab", onDbg);
    return () => {
      window.removeEventListener("anvil-problems", onProb);
      window.removeEventListener("anvil-debug-tab", onDbg);
    };
  }, []);
  useEffect(() => {
    if (tab !== "term") return;
    let live = true;
    void import("./term-pane").then((m) => {
      if (live) setTerm(() => m.TermPane);
    });
    return () => {
      live = false;
    };
  }, [tab]);
  useEffect(() => {
    if (debug.active || debug.paused) setTab("dbg");
  }, [debug.active, debug.paused]);
  const [repl, setRepl] = useState("");
  const [explain, setExplain] = useState("");
  const [trim, setTrim] = useState("");
  const [hist, setHist] = useState<string[]>(() => {
    try {
      const raw = sessionStorage.getItem("anvil-repl");
      return raw ? (JSON.parse(raw) as string[]).slice(0, 40) : [];
    } catch {
      return [];
    }
  });
  const [histI, setHistI] = useState(-1);
  const logs = output.filter((r) => !(r.ok && r.html && (r.stdout === "Vorschau." || !r.stderr)));
  const newest = logs.slice().reverse();
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [logs.length]);
  const last = logs[logs.length - 1];
  const tests = mergeTests(discoverTests(files), Object.values(testResults));
  const problems = [
    ...lspProblems.map((p) => ({ path: p.path, line: p.line, text: p.message, source: p.source })),
    ...pluginProblems,
  ];

  async function runRepl() {
    const code = repl.trim();
    if (!code) return;
    const next = [code, ...hist.filter((h) => h !== code)].slice(0, 40);
    setHist(next);
    setHistI(-1);
    try {
      sessionStorage.setItem("anvil-repl", JSON.stringify(next));
    } catch {
      /* ignore */
    }
    setRepl("");
    if (parseTestCommand(code)) {
      setTab("test");
      const r = await runAgentShell(code, useIde.getState().files);
      if (!r.ok && r.stderr) {
        pushOutput({ ok: false, stdout: r.stdout, stderr: r.stderr, duration: 0, label: "tests" });
      }
      return;
    }
    setTab("out");
    if (/^(python3?|py|node|bun|deno)\s+\S+/i.test(code)) {
      const r = await runAgentShell(code, useIde.getState().files);
      pushOutput({
        ok: r.ok,
        stdout: r.stdout,
        stderr: r.stderr,
        duration: 0,
        label: code,
      });
      return;
    }
    pushOutput(await evalSnippet(code, files, activePath ?? "repl.js"));
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="bar-scroll flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
        <button
          type="button"
          className={cn("h-7 shrink-0 whitespace-nowrap px-2 text-xs", tab === "out" ? "text-fg" : "text-muted")}
          onClick={() => setTab("out")}
        >
          {t("console")}
        </button>
        <button
          type="button"
          className={cn("h-7 shrink-0 whitespace-nowrap px-2 text-xs", tab === "dbg" ? "text-fg" : "text-muted")}
          onClick={() => setTab("dbg")}
        >
          {t("debug")}{debug.paused ? " ⏸" : debug.active ? " ●" : ""}
        </button>
        <button
          type="button"
          className={cn("h-7 shrink-0 whitespace-nowrap px-2 text-xs", tab === "prob" ? "text-fg" : "text-muted")}
          onClick={() => setTab("prob")}
        >
          {t("problems")}{problems.length ? ` ${problems.length}` : ""}
        </button>
        <button
          type="button"
          className={cn("h-7 shrink-0 whitespace-nowrap px-2 text-xs", tab === "test" ? "text-fg" : "text-muted")}
          onClick={() => setTab("test")}
        >
          {t("tests")}{tests.length ? ` ${tests.filter((x) => x.ok).length}/${tests.length}` : ""}
        </button>
        <button
          type="button"
          className={cn("h-7 shrink-0 whitespace-nowrap px-2 text-xs", tab === "term" ? "text-fg" : "text-muted")}
          onClick={() => setTab("term")}
        >
          Terminal
        </button>
        <span className="min-w-0 flex-1 px-2">
          <HelperPrompts where="output" />
        </span>
        {last?.stage?.kind === "window" ? (
          <span className="shrink-0 text-[10px] text-ok">Bühne · Fenster</span>
        ) : last?.stage?.kind === "log" ? (
          <span className="shrink-0 text-[10px] text-muted">Bühne · Log</span>
        ) : last?.html || last?.stage?.kind === "html" ? (
          <span className="shrink-0 text-[10px] text-muted">Bühne · HTML</span>
        ) : null}
        {popout ? null : (
          <>
            <Button
              variant="quiet"
              className="h-7 w-7 p-0"
              title={t("dockBottom")}
              aria-label={t("dockBottom")}
              onClick={() => setOutputDock("bottom")}
            >
              <PanelBottom className={cn("size-3.5", outputDock === "bottom" ? "text-fg" : "text-muted")} />
            </Button>
            <Button
              variant="quiet"
              className="h-7 w-7 p-0"
              title={t("dockSide")}
              aria-label={t("dockSide")}
              onClick={() => setOutputDock("side")}
            >
              <PanelRight className={cn("size-3.5", outputDock === "side" ? "text-fg" : "text-muted")} />
            </Button>
            <Button
              variant="quiet"
              className="h-7 w-7 p-0"
              title={t("ownWindow")}
              aria-label={t("ownWindow")}
              onClick={() => openOutputWindow()}
            >
              <SquareArrowOutUpRight className="size-3.5" />
            </Button>
          </>
        )}
        <Button variant="quiet" className="h-7 px-2 text-xs" title={t("clearConsole")} onClick={clearOutput}>
          {t("clear")}
        </Button>
        <CopyBtn
          tip={t("copyOut")}
          getText={() => {
            const last = newest[0];
            return last ? [last.stdout, last.stderr].filter(Boolean).join("\n") : "";
          }}
        />
        <Button
          variant="quiet"
          className="h-7 px-2 text-xs"
          title={t("explainLast")}
          onClick={() => {
            const last = [...output].reverse().find((r) => !r.ok);
            if (!last) return;
            setTab("out");
            setExplain("…");
            void import("@/lib/brain")
              .then((b) => b.brainExplainError(last.stderr || last.stdout, last.label))
              .then((s) => setExplain(s || t("noOut")))
              .catch((e) => setExplain(e instanceof Error ? e.message : "Fehler"));
          }}
        >
          {t("explain")}
        </Button>
        <Button
          variant="quiet"
          className="h-7 px-2 text-xs"
          title={t("logTrim")}
          onClick={() => {
            const last = [...output].reverse().find((r) => !r.ok) ?? output.at(-1);
            if (!last) return;
            setTab("out");
            setTrim("…");
            void import("@/lib/brain")
              .then((b) => b.brainLogTrim(last.stderr || last.stdout))
              .then((s) => setTrim(s || t("noOut")))
              .catch((e) => setTrim(e instanceof Error ? e.message : "Fehler"));
          }}
        >
          {t("logTrim")}
        </Button>
        <Button
          variant="quiet"
          className="h-7 px-2 text-xs"
          title={t("agentRun")}
          onClick={() => void import("@/lib/fix-agent").then((m) => m.askRun())}
        >
          {t("agentRun")}
        </Button>
        <Button
          variant="quiet"
          className="h-7 w-7 p-0"
          aria-label="Ausgabe schließen"
          onClick={() => {
            if (popout) {
              closeOutputWindow();
              window.close();
              return;
            }
            togglePanel("output");
          }}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {tab === "term" ? (
        <div className="min-h-0 flex-1">{Term ? <Term /> : null}</div>
      ) : (
      <>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-5">
        {tab === "dbg" ? (
          <DebugPane />
        ) : tab === "test" ? (
          tests.length === 0 ? (
            <div>
              <p className="text-muted">{t("noTestFiles")}</p>
              <p className="mt-2 text-[11px] text-subtle">{t("testHint")}</p>
              <button
                type="button"
                className="mt-3 text-xs text-fg underline"
                onClick={() => void runAllTests()}
              >
                {t("runAllTests")}
              </button>
            </div>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap gap-2 text-[11px]">
                <button type="button" className="text-fg underline" onClick={() => void runAllTests()}>
                  {t("runAllTests")}
                </button>
                {tests.some((x) => !x.ok && !x.skip) ? (
                  <button
                    type="button"
                    className="text-fg underline"
                    onClick={() => useIde.getState().pushAgent(testsPrompt(tests))}
                  >
                    {t("fixFails")}
                  </button>
                ) : null}
              </div>
              {tests.map((row, i) => (
                <button
                  key={`${row.path}:${row.name}:${i}`}
                  type="button"
                  className={cn(
                    "mb-1 block w-full text-left hover:underline",
                    row.skip ? "text-subtle" : row.ok ? "text-ok" : "text-danger",
                  )}
                  onClick={() => gotoFile(row.path, row.line)}
                >
                  {row.skip ? "○" : row.ok ? "ok" : "fail"} {row.name} · {row.path}:{row.line}
                </button>
              ))}
            </>
          )
        ) : tab === "prob" ? (
          problems.length === 0 ? (
            <p className="text-muted">{t("noProblems")}</p>
          ) : (
            <>
              <button
                type="button"
                className="mb-2 text-xs text-fg hover:underline"
                onClick={() => void import("@/lib/fix-agent").then((m) => m.fixHere())}
              >
                {t("fixProblems")}
              </button>
              {problems.map((p, i) => (
              <button
                key={i}
                type="button"
                className="mb-1 block w-full text-left text-danger hover:underline"
                onClick={() => gotoFile(p.path in files ? p.path : activePath ?? p.path, p.line)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  useIde.getState().pushAgent(problemsPrompt([p], files));
                }}
              >
                {p.path}:{p.line} · {p.source && !["syntax", "python", "index", "json", "js", "c"].includes(p.source) ? p.source : t("lintHeur")} · {p.text}
              </button>
            ))}
            </>
          )
        ) : logs.length === 0 ? (
          <p className="text-muted">{t("noOutput")}</p>
        ) : (
          <>
            {explain ? <p className="mb-3 whitespace-pre-wrap text-fg">{explain}</p> : null}
            {trim ? <p className="mb-3 whitespace-pre-wrap text-[12px] text-muted">{trim}</p> : null}
            {newest.map((r, i) => (
            <div key={`${r.label}-${logs.length - i}`} className="mb-3">
              <p className={cn("tabular-nums", r.ok ? "text-ok" : "text-danger")}>
                {r.stage?.kind === "window" ? "läuft" : r.ok ? t("ok") : t("fail")} · {r.label} · {r.duration.toFixed(2)}s
              </p>
              {r.stdout && r.stdout !== "Vorschau." ? <LogText text={r.stdout} /> : null}
              {r.stderr ? <LogText text={r.stderr} tone="danger" /> : null}
              {r.stage?.out ? <div className="mt-1 select-text break-all text-[11px] text-muted">Ausgabeordner: {r.stage.out}</div> : null}
            </div>
          ))}
          </>
        )}
      </div>
      <form
        className="flex border-t border-border"
        onSubmit={(e) => {
          e.preventDefault();
          void runRepl();
        }}
      >
        <span className="flex h-9 items-center px-2 font-mono text-xs text-subtle">anvil ›</span>
        <input
          value={repl}
          placeholder={t("replPh")}
          className="h-9 min-w-0 flex-1 bg-transparent font-mono text-xs text-fg outline-none placeholder:text-subtle"
          onChange={(e) => {
            setRepl(e.target.value);
            setHistI(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" && !e.altKey) {
              e.preventDefault();
              if (!hist.length) return;
              const n = histI < 0 ? 0 : Math.min(histI + 1, hist.length - 1);
              setHistI(n);
              setRepl(hist[n] ?? "");
            }
            if (e.key === "ArrowDown" && !e.altKey) {
              e.preventDefault();
              if (histI <= 0) {
                setHistI(-1);
                setRepl("");
                return;
              }
              const n = histI - 1;
              setHistI(n);
              setRepl(hist[n] ?? "");
            }
          }}
          aria-label={t("console")}
        />
        <button type="submit" className="h-9 px-2 text-[11px] text-muted hover:text-fg" disabled={!repl.trim()}>
          Enter
        </button>
      </form>
      </>
      )}
    </div>
  );
}
