import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { listCommands, pluginSnapshot, subscribePlugins } from "@/lib/plugins";
import { brainPalette, brainReady, loadBrain, useBrain } from "@/lib/brain";
import { zipFiles } from "@/lib/archive";
import { formatDocument } from "@/lib/format";
import { defsAt, wordAt } from "@/lib/lsp";
import { getIndex, rebuildIndex, searchIndex } from "@/lib/ws-index";
import { gotoFile } from "@/lib/goto";
import { useIde } from "@/store/ide";
import { useT } from "@/lib/i18n";
import { formatChord, KEY_DEFAULTS, type KeyId } from "@/lib/keymap";

export function CommandPalette() {
  const palette = useIde((s) => s.palette);
  const files = useIde((s) => s.files);
  const recentPaths = useIde((s) => s.recentPaths);
  const setPalette = useIde((s) => s.setPalette);
  const openFile = useIde((s) => s.openFile);
  const togglePanel = useIde((s) => s.togglePanel);
  const setSidebar = useIde((s) => s.setSidebar);
  const setSettingsOpen = useIde((s) => s.setSettingsOpen);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const [brainHit, setBrainHit] = useState<string | null>(null);
  const t = useT();
  useSyncExternalStore(subscribePlugins, pluginSnapshot, pluginSnapshot);

  useEffect(() => {
    setQ("");
    setI(0);
  }, [palette]);

  const items = useMemo(() => {
    if (palette === "files") {
      const qn = q.toLowerCase();
      const rec = recentPaths.filter((p) => p in files);
      const keys = Object.keys(files).sort();
      const ordered = qn
        ? keys.filter((p) => p.toLowerCase().includes(qn))
        : [...rec, ...keys.filter((p) => !rec.includes(p))];
      return ordered.map((path) => ({
        id: path,
        label: !qn && rec.includes(path) ? `${t("recently")}  ${path}` : path,
        run: () => openFile(path),
      }));
    }
    if (palette === "symbols") {
      rebuildIndex(files);
      const hits =
        q.trim().length < 1
          ? getIndex()
              .flatMap((r) =>
                r.symbols.map((s) => ({
                  kind: "symbol" as const,
                  path: r.path,
                  line: s.line,
                  label: `${s.name}  ${r.path}:${s.line}`,
                })),
              )
              .slice(0, 50)
          : searchIndex(q, files, 50);
      return hits.map((h, n) => ({
        id: `${h.path}:${h.line}:${n}`,
        label: h.label,
        run: () => gotoFile(h.path, h.line),
      }));
    }
    if (palette === "commands") {
      const cmds = [
        { id: "debug", label: t("cmdDebug"), run: () => window.dispatchEvent(new Event("anvil-debug")) },
        { id: "debug-step", label: t("cmdDebugStep"), run: () => window.dispatchEvent(new Event("anvil-debug-step")) },
        { id: "debug-stop", label: t("cmdDebugStop"), run: () => window.dispatchEvent(new Event("anvil-debug-stop")) },
        { id: "fix", label: t("fixHere"), run: () => { void import("@/lib/fix-agent").then((m) => m.fixHere()); } },
        { id: "ask-debug", label: t("agentDebug"), run: () => { void import("@/lib/fix-agent").then((m) => m.askDebug()); } },
        { id: "ask-run", label: t("agentRun"), run: () => { void import("@/lib/fix-agent").then((m) => m.askRun()); } },
        { id: "ask-git", label: t("agentGit"), run: () => { void import("@/lib/fix-agent").then((m) => m.askGit()); } },
        { id: "agent", label: t("cmdAgent"), run: () => togglePanel("agent") },
        { id: "trail", label: t("cmdTrail"), run: () => togglePanel("trail") },
        { id: "term", label: t("cmdTerm"), run: () => togglePanel("output") },
        { id: "term-side", label: t("cmdTermSide"), run: () => useIde.getState().setOutputDock("side") },
        { id: "term-bottom", label: t("cmdTermBottom"), run: () => useIde.getState().setOutputDock("bottom") },
        { id: "term-win", label: t("cmdTermWin"), run: () => window.dispatchEvent(new Event("anvil-output-popout")) },
        { id: "run-win", label: t("cmdRunWin"), run: () => window.dispatchEvent(new Event("anvil-run-popout")) },
        { id: "reveal", label: t("cmdReveal"), run: () => { const p = useIde.getState().activePath; if (p) useIde.getState().revealPath(p); } },
        { id: "newfile", label: t("newFile"), run: () => { setSidebar("files"); window.dispatchEvent(new CustomEvent("anvil-new-file", { detail: "file" })); } },
        { id: "starter", label: t("starter"), run: () => window.dispatchEvent(new Event("anvil-starter")) },
        { id: "newfolder", label: t("newFolder"), run: () => { setSidebar("files"); window.dispatchEvent(new CustomEvent("anvil-new-file", { detail: "dir" })); } },
        { id: "refresh-disk", label: "Dateien von Platte abgleichen", run: () => { void import("@/lib/external-files").then((m) => m.refreshExternalFiles()); } },
        { id: "opendisk", label: t("cmdOpenDisk"), run: () => window.dispatchEvent(new Event("anvil-open-disk")) },
        { id: "savedisk", label: t("save"), run: () => { void import("@/lib/save").then((s) => s.saveNow()); } },
        { id: "tests", label: t("runAllTests"), run: () => { setSidebar("tests"); void import("@/lib/run-tests").then((m) => m.runAllTests()); } },
        { id: "ref", label: t("refs"), run: () => setSidebar("ref") },
        { id: "tests", label: t("tests"), run: () => setSidebar("tests") },
        { id: "mcp", label: t("mcp"), run: () => setSidebar("mcp") },
        { id: "git", label: t("cmdGit"), run: () => setSidebar("git") },
        { id: "learn", label: t("memory"), run: () => setSidebar("learn") },
        { id: "format", label: t("cmdFormat"), run: () => {
          const s = useIde.getState();
          const p = s.activePath;
          if (!p) return;
          void formatDocument(p);
        } },
        { id: "symbols", label: t("cmdGotoSymbol"), run: () => window.dispatchEvent(new Event("anvil-symbols")) },
        { id: "wssymbols", label: t("cmdGotoWsSymbol"), run: () => setPalette("symbols") },
        { id: "back", label: t("cmdBack"), run: () => useIde.getState().goJump(-1) },
        { id: "reopen", label: t("cmdReopen"), run: () => useIde.getState().reopenTab() },
        { id: "peek", label: t("cmdPeek"), run: () => {
          const s = useIde.getState();
          const p = s.activePath;
          if (!p) return;
          const src = s.files[p] ?? "";
          const lines = src.split("\n");
          let off = 0;
          for (let i = 0; i < s.cursor.line - 1 && i < lines.length; i++) off += lines[i].length + 1;
          off += Math.max(0, s.cursor.col - 1);
          const w = wordAt(src, off);
          void defsAt(s.files, p, off, s.openPaths).then((defs) => {
            if (!defs.length) s.setNotice(t("noDef"));
            else s.setPeek({ word: w, defs });
          });
        } },
        { id: "intern", label: t("cmdIntern"), run: () => void import("@/lib/intern").then((m) => m.useIntern.getState().setPane(true)) },
        { id: "intern-soft", label: t("cmdSoft"), run: () => void import("@/lib/intern").then((m) => m.useIntern.getState().restart("soft")) },
        { id: "intern-hard", label: t("cmdHard"), run: () => location.reload() },
        { id: "board", label: t("cmdBoard"), run: () => useIde.getState().setHarnessBoardOpen(true) },
        { id: "ask", label: t("cmdAsk"), run: () => useIde.getState().setAgentMode("ask") },
        { id: "agentmode", label: t("cmdAgentMode"), run: () => useIde.getState().setAgentMode("agent") },
        { id: "newchat", label: t("newChat"), run: () => { void import("@/lib/abort").then((m) => m.stopAgent("Neuer Chat")); useIde.getState().clearChat(); } },
        { id: "helper-comment", label: t("cmdHelperComment"), run: () => window.dispatchEvent(new Event("anvil-helper-comment")) },
        { id: "helper-i18n", label: t("cmdHelperI18n"), run: () => {
          const s = useIde.getState();
          const p = s.activePath;
          if (!p) return;
          const src = s.files[p] ?? "";
          const line = src.split("\n")[Math.max(0, s.cursor.line - 1)] ?? "";
          void import("@/lib/brain").then((b) =>
            b.brainI18nKey(line.trim() || p).then((k) => {
              const blob = `${k.key}: "${k.de}" / "${k.en}"`;
              void navigator.clipboard?.writeText(`${k.key}: "${k.de}"`).catch(() => undefined);
              s.setNotice(blob);
            }),
          );
        } },
        { id: "brain-off", label: t("unload"), run: () => void import("@/lib/brain").then((b) => b.unloadBrain()) },
        { id: "patch", label: t("cmdPatch"), run: () => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".patch,.diff,.anvil-patch,.json";
          input.onchange = () => {
            const f = input.files?.[0];
            if (!f) return;
            void f.text().then(async (text) => {
              const { parsePatch, commitPatch } = await import("@/lib/patch");
              const plan = parsePatch(text, useIde.getState().files);
              if (!Object.keys(plan.write).length && !plan.del.length) {
                useIde.getState().setNotice(plan.errors[0] || "Patch leer");
                return;
              }
              await commitPatch(plan);
            });
          };
          input.click();
        } },
        { id: "zip", label: t("zipProject"), run: () => {
          void zipFiles(useIde.getState().files).then((blob) => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "anvil-project.zip";
            a.click();
            URL.revokeObjectURL(a.href);
          });
        } },
        { id: "undo-round", label: t("cmdUndoRound"), run: () => {
          const cks = useIde.getState().checkpoints;
          const last = cks[cks.length - 1];
          if (!last) return;
          const ok = useIde.getState().restoreCheckpoint(last.id);
          useIde.getState().setNotice(ok ? t("undoRoundOk") : t("noSnapshot"));
        } },
      ];
      const pluginCmds = listCommands().map((c) => ({
        id: c.id,
        label: c.title,
        run: () => void c.run(),
      }));
      const km = useIde.getState().keyMap;
      const palKey: Record<string, KeyId> = {
        debug: "debug",
        "debug-step": "debugStep",
        "debug-stop": "debugStop",
        agent: "agent",
        term: "output",
        "run-win": "runWin",
        newfile: "newFile",
        newfolder: "newFolder",
        git: "git",
        learn: "memory",
        format: "format",
        symbols: "symbols",
        back: "back",
        reopen: "reopen",
        peek: "peek",
        intern: "intern",
        board: "board",
        tests: "tests",
        ref: "refs",
        "undo-round": "back",
      };
      return [...cmds, ...pluginCmds]
        .filter((c) => c.label.toLowerCase().includes(q.toLowerCase()))
        .map((c) => {
          const kid = palKey[c.id];
          return kid ? { ...c, kbd: formatChord(km[kid] ?? KEY_DEFAULTS[kid]) } : c;
        });
    }
    return [];
  }, [palette, files, q, openFile, togglePanel, setSidebar, setSettingsOpen, recentPaths, t]);

  useEffect(() => {
    if (palette !== "commands" || items.length > 0 || q.trim().length < 3) {
      setBrainHit(null);
      return;
    }
    if (!brainReady() || !useBrain.getState().jobs.palette) return;
    const labels = [
      "Debug starten",
      "Agent ein/aus",
      "Ausgabe ein/aus",
      "Explorer",
      "Suchen",
      "Quelle",
      "Gedächtnis",
      "Einstellungen",
      "Vorschau ein/aus",
      "Helfer laden",
    ];
    let alive = true;
    void brainPalette(q, labels).then((hit) => {
      if (alive) setBrainHit(hit);
    });
    return () => {
      alive = false;
    };
  }, [palette, items.length, q]);

  if (!palette) return null;

  function pick(idx: number) {
    const item = items[idx];
    if (!item) return;
    item.run();
    setPalette(null);
  }

  return (
    <div className="ui-overlay absolute inset-0 z-40 flex items-start justify-center pt-16">
      <button
        type="button"
        className="absolute inset-0 bg-bg/70"
        aria-label="Schließen"
        onClick={() => setPalette(null)}
      />
      <div className="ui-pop relative w-full max-w-lg overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
        <input
          autoFocus
          value={q}
          placeholder={palette === "files" ? t("keyOpenFile") : palette === "symbols" ? t("cmdGotoWsSymbol") : t("keyPalette")}
          className="h-11 w-full border-b border-border bg-transparent px-4 text-sm text-fg outline-none placeholder:text-subtle"
          onChange={(e) => {
            setQ(e.target.value);
            setI(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setPalette(null);
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setI((n) => Math.min(n + 1, items.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setI((n) => Math.max(n - 1, 0));
            }
            if (e.key === "Enter") {
              e.preventDefault();
              pick(i);
            }
          }}
        />
        <ul className="ui-stagger max-h-72 overflow-auto py-1">
          {items.length === 0 ? (
            <li className="px-4 py-3 text-sm text-muted">
              {brainHit ? t("helperSuggest", { hit: brainHit }) : t("noneFound")}
            </li>
          ) : (
            items.slice(0, 40).map((item, idx) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`flex h-9 w-full items-center gap-3 px-4 text-left text-sm ${
                    idx === i ? "bg-hover text-fg" : "text-muted hover:bg-hover hover:text-fg"
                  }`}
                  onMouseEnter={() => setI(idx)}
                  onClick={() => pick(idx)}
                >
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {typeof (item as { kbd?: string }).kbd === "string" ? (
                    <span className="shrink-0 font-mono text-[10px] text-subtle">{(item as { kbd?: string }).kbd}</span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
