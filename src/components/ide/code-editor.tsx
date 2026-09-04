import { useEffect, useRef, useState } from "react";
import { formatCode } from "@/lib/format";
import type { LangId } from "@/lib/languages";
import { defineAnvilThemes, editorChrome, loadMonaco, monacoLang, pruneModels, wireNav, type MonacoEditor, type MonacoNS } from "@/lib/monaco";
import { applyModelText, markerEndCol, modelUriString } from "@/lib/monaco-models";
import { defsAt, wordAt } from "@/lib/lsp";
import { gotoFile } from "@/lib/goto";
import { emitPlugin } from "@/lib/plugins/events";
import { debugContinue, debugStep, debugStop, startDebug } from "@/lib/debug-engine";
import { prefixAt, suggest, type Suggestion } from "@/lib/suggest";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useIde } from "@/store/ide";

export type TextSel = { start: number; end: number; text: string };

type Props = {
  path: string;
  value: string;
  language: LangId;
  onChange: (value: string) => void;
  onRun?: () => void;
  onInlineEdit?: (sel: TextSel) => void;
  onAskSelection?: (sel: TextSel) => void;
  onFind?: () => void;
  onGoto?: () => void;
};

export function CodeEditor({ path, value, language, onChange, onRun, onInlineEdit, onAskSelection }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const edRef = useRef<MonacoEditor | null>(null);
  const monacoRef = useRef<MonacoNS | null>(null);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const onInlineRef = useRef(onInlineEdit);
  const onAskRef = useRef(onAskSelection);
  const valueRef = useRef(value);
  const langRef = useRef(language);
  const pathRef = useRef(path);
  onChangeRef.current = onChange;
  onRunRef.current = onRun;
  onInlineRef.current = onInlineEdit;
  onAskRef.current = onAskSelection;
  valueRef.current = value;
  langRef.current = language;
  pathRef.current = path;

  const fontSize = useIde((s) => s.fontSize);
  const tabSize = useIde((s) => s.tabSize);
  const lineNumbers = useIde((s) => s.lineNumbers);
  const wordWrap = useIde((s) => s.wordWrap);
  const editorMinimap = useIde((s) => s.editorMinimap);
  const editorSticky = useIde((s) => s.editorSticky);
  const editorGuides = useIde((s) => s.editorGuides);
  const editorWheelZoom = useIde((s) => s.editorWheelZoom);
  const insertSpaces = useIde((s) => s.insertSpaces);
  const suggestOn = useIde((s) => s.suggestOn);
  const theme = useIde((s) => s.theme);
  const filesRef = useRef(useIde.getState().files);
  filesRef.current = useIde.getState().files;
  const breakpoints = useIde((s) => s.breakpoints);
  const debug = useIde((s) => s.debug);
  const lspProblems = useIde((s) => s.lspProblems);
  const suggestOnRef = useRef(suggestOn);
  suggestOnRef.current = suggestOn;
  const [hints, setHints] = useState<Suggestion[]>([]);
  const hintsRef = useRef<Suggestion[]>([]);
  const decosRef = useRef<string[]>([]);
  hintsRef.current = hints;
  const setCursor = useIde((s) => s.setCursor);
  const setSelection = useIde((s) => s.setSelection);
  const setPalette = useIde((s) => s.setPalette);
  const viewsRef = useRef(new Map<string, unknown>());
  const viewPathRef = useRef(path);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    let dead = false;
    const subs: { dispose: () => void }[] = [];
    let brainTimer = 0;
    void loadMonaco()
      .then((monaco) => {
        if (dead || !hostRef.current) return;
        monacoRef.current = monaco;
        defineAnvilThemes(monaco, useIde.getState().theme);
        wireNav(monaco);
        const uri = monaco.Uri.parse(modelUriString(pathRef.current));
        let model = monaco.editor.getModel(uri);
        if (!model) model = monaco.editor.createModel(valueRef.current, monacoLang(langRef.current), uri);
        const ed = monaco.editor.create(hostRef.current, {
          model,
          ...editorChrome(useIde.getState()),
        });
        edRef.current = ed;
        const go = (window as unknown as { __anvilGoto?: { path: string; line: number } }).__anvilGoto;
        if (go && go.path === pathRef.current) {
          ed.revealLineInCenter?.(go.line);
          ed.setPosition({ lineNumber: go.line, column: 1 });
          (window as unknown as { __anvilGoto?: { path: string; line: number } }).__anvilGoto = undefined;
        }
        const KM = monaco.KeyMod;
        const KC = monaco.KeyCode;
        ed.addAction({
          id: "anvil.debug",
          label: "Debug",
          keybindings: [],
          run: () => {
            const st = useIde.getState();
            if (st.debug.paused) debugContinue();
            else if (!st.debug.active) {
              const hasBp = Object.values(st.breakpoints).some((a) => a.length);
              st.revealOutput();
              void startDebug(pathRef.current, st.files, { pauseOnEntry: !hasBp });
            }
          },
        });
        ed.addAction({
          id: "anvil.debug-stop",
          label: "Debug stoppen",
          keybindings: [],
          run: () => debugStop(),
        });
        ed.addAction({
          id: "anvil.debug-step",
          label: "Step",
          keybindings: [],
          run: () => debugStep(),
        });
        ed.addAction({
          id: "anvil.bp",
          label: "Breakpoint",
          keybindings: [],
          run: () => {
            const pos = ed.getPosition();
            if (pos) useIde.getState().toggleBreakpoint(pathRef.current, pos.lineNumber);
          },
        });
        subs.push(
          ed.onMouseDown((e) => {
            const pos = e.target.position;
            const line = pos?.lineNumber;
            if (!line || !pos) return;
            const gutter = e.target.type === 2 || e.target.type === 3;
            if (gutter) {
              useIde.getState().toggleBreakpoint(pathRef.current, line);
              return;
            }
            if (!(e.event?.ctrlKey || e.event?.metaKey)) return;
            const modelNow = ed.getModel();
            if (!modelNow) return;
            const src = ed.getValue();
            const offset = modelNow.getOffsetAt(pos);
            const st = useIde.getState();
            const p = pathRef.current;
            void defsAt({ ...st.files, [p]: src }, p, offset, st.openPaths).then((defs) => {
              const d = defs[0];
              if (d) gotoFile(d.path, d.line);
            });
          }),
        );
        ed.addAction({
          id: "anvil.fix-agent",
          label: "Mit Agent beheben",
          keybindings: [],
          contextMenuGroupId: "1_modification",
          run: () => {
            const pos = ed.getPosition();
            void import("@/lib/fix-agent").then((m) => m.fixHere(pathRef.current, pos?.lineNumber));
          },
        });
        ed.addAction({
          id: "anvil.inline",
          label: "Inline-Edit",
          keybindings: [],
          run: () => {
            const sel = ed.getSelection();
            const modelNow = ed.getModel();
            if (!sel || !modelNow) {
              onInlineRef.current?.({ start: 0, end: ed.getValue().length, text: ed.getValue() });
              return;
            }
            const start = modelNow.getOffsetAt({ lineNumber: sel.startLineNumber, column: sel.startColumn });
            const end = modelNow.getOffsetAt({ lineNumber: sel.endLineNumber, column: sel.endColumn });
            const text = start === end ? ed.getValue() : modelNow.getValueInRange(sel);
            onInlineRef.current?.({
              start: start === end ? 0 : start,
              end: start === end ? ed.getValue().length : end,
              text,
            });
          },
        });
        ed.addAction({
          id: "anvil.def",
          label: "Gehe zu Definition",
          keybindings: [],
          run: () => {
            const pos = ed.getPosition();
            const modelNow = ed.getModel();
            if (!pos || !modelNow) return;
            const src = ed.getValue();
            const offset = modelNow.getOffsetAt(pos);
            const st = useIde.getState();
            const p = pathRef.current;
            const files = { ...st.files, [p]: src };
            void defsAt(files, p, offset, st.openPaths).then((defs) => {
              const d = defs[0];
              if (!d) {
                useIde.getState().setNotice("Keine Definition");
                return;
              }
              gotoFile(d.path, d.line);
            });
          },
        });
        ed.addAction({
          id: "anvil.peek",
          label: "Peek Definition",
          keybindings: [],
          run: () => {
            const pos = ed.getPosition();
            const modelNow = ed.getModel();
            if (!pos || !modelNow) return;
            const src = ed.getValue();
            const offset = modelNow.getOffsetAt(pos);
            const st = useIde.getState();
            const p = pathRef.current;
            const files = { ...st.files, [p]: src };
            const w = wordAt(src, offset);
            void defsAt(files, p, offset, st.openPaths).then((defs) => {
              if (!defs.length) {
                useIde.getState().setNotice("Keine Definition");
                return;
              }
              useIde.getState().setPeek({ word: w, defs });
            });
          },
        });
        ed.addAction({
          id: "anvil.format",
          label: "Dokument formatieren",
          keybindings: [],
          run: () => {
            void formatCode(pathRef.current, ed.getValue())
              .then((next) => {
                onChangeRef.current(next);
                useIde.getState().setNotice("Formatiert");
              })
              .catch(() => useIde.getState().setNotice("Format fehlgeschlagen"));
          },
        });
        ed.addAction({
          id: "anvil.dupline",
          label: "Zeile duplizieren",
          keybindings: [],
          run: () => {
            const pos = ed.getPosition();
            if (!pos) return;
            const line = ed.getValue().split("\n")[pos.lineNumber - 1] ?? "";
            ed.executeEdits("dup", [
              {
                range: {
                  startLineNumber: pos.lineNumber,
                  startColumn: 1,
                  endLineNumber: pos.lineNumber,
                  endColumn: 1,
                },
                text: `${line}\n`,
              },
            ]);
          },
        });
        ed.addAction({
          id: "anvil.agent",
          label: "Agent / Ask Auswahl",
          keybindings: [],
          run: () => {
            const sel = ed.getSelection();
            const modelNow = ed.getModel();
            if (sel && modelNow && (sel.startLineNumber !== sel.endLineNumber || sel.startColumn !== sel.endColumn)) {
              const text = modelNow.getValueInRange(sel);
              onAskRef.current?.({
                start: modelNow.getOffsetAt({ lineNumber: sel.startLineNumber, column: sel.startColumn }),
                end: modelNow.getOffsetAt({ lineNumber: sel.endLineNumber, column: sel.endColumn }),
                text,
              });
              return;
            }
            void import("@/lib/save").then((s) => s.focusAgent());
          },
        });
        ed.addAction({
          id: "anvil.replace",
          label: "Ersetzen",
          keybindings: [KM.CtrlCmd | KC.KeyH],
          run: () => window.dispatchEvent(new Event("anvil-replace")),
        });
        ed.addAction({
          id: "anvil.symbols",
          label: "Gehe zu Symbol",
          keybindings: [],
          run: () => window.dispatchEvent(new Event("anvil-symbols")),
        });
        ed.addAction({
          id: "anvil.wssymbols",
          label: "Symbol im Workspace",
          keybindings: [],
          run: () => setPalette("symbols"),
        });
        ed.addAction({
          id: "anvil.move-up",
          label: "Zeile nach oben",
          keybindings: [],
          run: () => ed.trigger?.("anvil", "editor.action.moveLinesUpAction"),
        });
        ed.addAction({
          id: "anvil.move-down",
          label: "Zeile nach unten",
          keybindings: [],
          run: () => ed.trigger?.("anvil", "editor.action.moveLinesDownAction"),
        });
        ed.addAction({
          id: "anvil.comment",
          label: "Zeile kommentieren",
          keybindings: [],
          run: () => ed.trigger?.("anvil", "editor.action.commentLine"),
        });
        ed.addAction({
          id: "anvil.find",
          label: "Suchen",
          keybindings: [KM.CtrlCmd | KC.KeyF],
          run: () => window.dispatchEvent(new Event("anvil-find")),
        });
        ed.addAction({
          id: "anvil.goto-line",
          label: "Gehe zu Zeile",
          keybindings: [KM.CtrlCmd | KC.KeyG],
          run: () => window.dispatchEvent(new Event("anvil-goto")),
        });
        ed.addAction({
          id: "anvil.files",
          label: "Datei öffnen",
          keybindings: [],
          run: () => setPalette("files"),
        });
        ed.addAction({
          id: "anvil.commands",
          label: "Befehle",
          keybindings: [],
          run: () => setPalette("commands"),
        });
        ed.addAction({
          id: "anvil.save",
          label: "Speichern",
          keybindings: [],
          run: () => {
            const st = useIde.getState();
            const finish = (src: string) => {
              onChangeRef.current(src);
              void import("@/lib/save").then((s) => s.saveNow());
            };
            if (!st.formatOnSave) {
              finish(ed.getValue());
              return;
            }
            void formatCode(pathRef.current, ed.getValue())
              .then(finish)
              .catch(() => {
                useIde.getState().setNotice("Format fehlgeschlagen — ungeformt gespeichert");
                finish(ed.getValue());
              });
          },
        });
        ed.addAction({
          id: "anvil.preview",
          label: "Vorschau",
          keybindings: [],
          run: () => useIde.getState().setPreviewOpen(!useIde.getState().previewOpen),
        });
        ed.addAction({
          id: "anvil.fix-problems",
          label: "Unterschlangen an den Agenten",
          contextMenuGroupId: "9_anvil",
          run: () => {
            const line = ed.getPosition()?.lineNumber;
            void import("@/lib/fix-agent").then((m) => m.fixHere(pathRef.current, line));
          },
        });
        ed.addAction({
          id: "anvil.helper-comment",
          label: "Helfer: Kommentar",
          contextMenuGroupId: "9_anvil",
          run: () => {
            const sel = ed.getSelection();
            const modelNow = ed.getModel();
            if (!sel || !modelNow) return;
            const text = modelNow.getValueInRange(sel).trim() || (ed.getValue().split("\n")[sel.startLineNumber - 1] ?? "");
            const lang = pathRef.current.split(".").pop() ?? "js";
            void import("@/lib/brain").then((b) =>
              b.brainComment(lang, text).then((c) => {
                if (!c) return;
                ed.executeEdits("anvil-comment", [
                  {
                    range: {
                      startLineNumber: sel.startLineNumber,
                      startColumn: 1,
                      endLineNumber: sel.startLineNumber,
                      endColumn: 1,
                    },
                    text: `${c}\n`,
                  },
                ]);
              }),
            );
          },
        });
        ed.addAction({
          id: "anvil.ask-sel",
          label: "Auswahl fragen",
          contextMenuGroupId: "9_anvil",
          run: () => {
            const sel = ed.getSelection();
            const modelNow = ed.getModel();
            if (!sel || !modelNow || (sel.startLineNumber === sel.endLineNumber && sel.startColumn === sel.endColumn)) return;
            const text = modelNow.getValueInRange(sel);
            onAskRef.current?.({
              start: modelNow.getOffsetAt({ lineNumber: sel.startLineNumber, column: sel.startColumn }),
              end: modelNow.getOffsetAt({ lineNumber: sel.endLineNumber, column: sel.endColumn }),
              text,
            });
          },
        });
        const refreshHints = () => {
          if (!suggestOnRef.current) {
            setHints([]);
            return;
          }
          const pos = ed.getPosition();
          const modelNow = ed.getModel();
          if (!pos || !modelNow) return;
          const line = modelNow.getValueInRange({
            startLineNumber: pos.lineNumber,
            startColumn: 1,
            endLineNumber: pos.lineNumber,
            endColumn: pos.column,
          });
          const { prefix, prev } = prefixAt(line);
          const local = suggest({
            source: ed.getValue(),
            prefix,
            prev,
            lang: langRef.current,
            files: filesRef.current,
            path: pathRef.current,
          });
          setHints(local);
          window.clearTimeout(brainTimer);
          if (prefix.length >= 3 && suggestOnRef.current) {
            const snap = { prefix, line, lang: langRef.current };
            brainTimer = window.setTimeout(() => {
              void import("@/lib/brain").then(async (b) => {
                if (dead || !b.brainReady() || !b.useBrain.getState().jobs.complete) return;
                const rest = await b.brainCompleteCode({ lang: snap.lang, prefix: snap.prefix, before: snap.line });
                if (!rest || dead) return;
                setHints((prevHints) => {
                  const hit: Suggestion = { text: snap.prefix + rest, rest, kind: "snip", insert: rest };
                  return [hit, ...prevHints.filter((h) => h.insert !== rest)].slice(0, 4);
                });
              });
            }, 450);
          }
        };
        subs.push(
          ed.onDidChangeModelContent(() => {
            const v = ed.getValue();
            if (v !== valueRef.current) onChangeRef.current(v);
            refreshHints();
          }),
        );
        subs.push(
          ed.onDidChangeCursorPosition((e) => {
            setCursor(e.position.lineNumber, e.position.column);
            const sel = ed.getSelection();
            if (sel) setSelection(sel.startLineNumber, sel.startColumn, sel.endLineNumber, sel.endColumn);
            refreshHints();
          }),
        );
        ed.focus();
        function onReveal(ev: Event) {
          const d = (ev as CustomEvent<{ path?: string; offset?: number; len?: number }>).detail;
          if (!d || d.path !== pathRef.current || typeof d.offset !== "number") return;
          const modelNow = ed.getModel();
          if (!modelNow?.getPositionAt) return;
          const start = modelNow.getPositionAt(d.offset);
          const end = modelNow.getPositionAt(d.offset + (d.len ?? 0));
          ed.setSelection?.({
            startLineNumber: start.lineNumber,
            startColumn: start.column,
            endLineNumber: end.lineNumber,
            endColumn: end.column,
          });
          ed.revealPositionInCenter?.(start);
          ed.focus();
        }
        window.addEventListener("anvil-reveal-offset", onReveal);
        subs.push({ dispose: () => window.removeEventListener("anvil-reveal-offset", onReveal) });
      })
      .catch((err) => {
        if (hostRef.current) {
          hostRef.current.textContent = err instanceof Error ? err.message : "Editor nicht geladen.";
        }
      });
    return () => {
      dead = true;
      window.clearTimeout(brainTimer);
      for (const s of subs) s.dispose();
      edRef.current?.dispose();
      edRef.current = null;
      const monaco = monacoRef.current;
      if (monaco) pruneModels(monaco, useIde.getState().openPaths);
    };
    // ein Editor, Modelle per Tab
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let prev = useIde.getState().openPaths.join("\n");
    return useIde.subscribe((s) => {
      const next = s.openPaths.join("\n");
      if (next === prev) return;
      prev = next;
      const monaco = monacoRef.current;
      if (monaco) pruneModels(monaco, s.openPaths);
    });
  }, []);

  useEffect(() => {
    const map: Record<string, string> = {
      "anvil-inline": "anvil.inline",
      "anvil-gotoDef": "anvil.def",
      "anvil-peek": "anvil.peek",
      "anvil-format": "anvil.format",
      "anvil-dup": "anvil.dupline",
      "anvil-replace": "anvil.replace",
      "anvil-symbols": "anvil.symbols",
      "anvil-moveUp": "anvil.move-up",
      "anvil-moveDown": "anvil.move-down",
      "anvil-comment": "anvil.comment",
      "anvil-helper-comment": "anvil.helper-comment",
      "anvil-breakpoint": "anvil.bp",
      "anvil-fixAgent": "anvil.fix-agent",
      "anvil-ask-sel": "anvil.agent",
    };
    function on(e: Event) {
      const id = map[e.type];
      const ed = edRef.current;
      if (!id || !ed) return;
      void ed.getAction?.(id)?.run();
    }
    const names = Object.keys(map);
    function onFocus() {
      edRef.current?.focus();
    }
    for (const n of names) window.addEventListener(n, on);
    window.addEventListener("anvil-focus-editor", onFocus);
    return () => {
      for (const n of names) window.removeEventListener(n, on);
      window.removeEventListener("anvil-focus-editor", onFocus);
    };
  }, []);

  useEffect(() => {
    const monaco = monacoRef.current;
    const ed = edRef.current;
    if (!monaco || !ed) return;
    const prev = viewPathRef.current;
    if (prev && prev !== path && ed.saveViewState) viewsRef.current.set(prev, ed.saveViewState());
    viewPathRef.current = path;
    const uri = monaco.Uri.parse(modelUriString(path));
    let model = monaco.editor.getModel(uri);
    if (!model) model = monaco.editor.createModel(valueRef.current, monacoLang(language), uri);
    else applyModelText(model as Parameters<typeof applyModelText>[0], valueRef.current);
    if (ed.getModel() !== model) {
      ed.setModel(model);
      setHints([]);
    }
    monaco.editor.setModelLanguage(model, monacoLang(language));
    const vs = viewsRef.current.get(path);
    if (vs && ed.restoreViewState) ed.restoreViewState(vs);
  }, [path, language]);

  useEffect(() => {
    const ed = edRef.current;
    const model = ed?.getModel();
    if (!ed || !model) return;
    if (model.getValue() === value) return;
    const pos = ed.getPosition();
    applyModelText(model, value);
    if (pos) ed.setPosition(pos);
  }, [value]);

  useEffect(() => {
    const ed = edRef.current;
    const monaco = monacoRef.current;
    const model = ed?.getModel();
    if (!ed || !monaco?.editor.setModelMarkers || !model) return;
    const sev = monaco.MarkerSeverity;
    monaco.editor.setModelMarkers(
      model,
      "anvil",
      lspProblems
        .filter((p) => p.path === path)
        .map((p) => ({
          startLineNumber: p.line,
          startColumn: p.col || 1,
          endLineNumber: p.line,
          endColumn: markerEndCol(p.col || 1, p.message),
          message: p.message,
          severity: p.severity === "warning" ? (sev?.Warning ?? 4) : p.severity === "info" ? (sev?.Info ?? 2) : (sev?.Error ?? 8),
          source: ["syntax", "python", "index", "json", "js", "c"].includes(p.source) ? t("lintHeur") : p.source,
        })),
    );
  }, [lspProblems, path]);

  useEffect(() => {
    edRef.current?.updateOptions(editorChrome(useIde.getState()));
  }, [fontSize, tabSize, insertSpaces, wordWrap, lineNumbers, editorMinimap, editorSticky, editorGuides, editorWheelZoom, suggestOn]);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (monaco) defineAnvilThemes(monaco, theme);
  }, [theme]);

  useEffect(() => {
    const ed = edRef.current;
    if (!ed) return;
    const bps = breakpoints[path] ?? [];
    const next: object[] = bps.map((line) => ({
      range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
      options: { glyphMarginClassName: "dbg-bp" },
    }));
    if (debug.paused && debug.path === path && debug.line > 0) {
      next.push({
        range: { startLineNumber: debug.line, startColumn: 1, endLineNumber: debug.line, endColumn: 1 },
        options: { isWholeLine: true, className: "dbg-cur", glyphMarginClassName: "dbg-cur-g" },
      });
      ed.revealLineInCenter?.(debug.line);
    }
    decosRef.current = ed.deltaDecorations(decosRef.current, next);
  }, [breakpoints, debug.paused, debug.line, debug.path, path]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {suggestOn && hints.length > 0 ? (
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-surface px-2">
          {hints.map((h, i) => (
            <button
              key={h.text + h.kind}
              type="button"
              className={cn(
                "h-6 max-w-[28%] truncate rounded-md px-2 font-mono text-[11px]",
                i === 0 ? "bg-hover text-fg" : "text-muted hover:bg-hover hover:text-fg",
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                acceptHint(h);
              }}
            >
              <span className="text-subtle">{h.text.slice(0, h.text.length - h.rest.length)}</span>
              {h.rest || h.text}
              {h.kind === "snip" ? <span className="ml-1 text-[9px] text-subtle">⇥</span> : null}
            </button>
          ))}
          <span className="ml-auto hidden text-[10px] text-subtle sm:inline">Tab übernimmt</span>
        </div>
      ) : null}
      <div
        ref={hostRef}
        className="min-h-0 min-w-0 flex-1"
        style={{ height: "100%" }}
        onKeyDownCapture={(e) => {
          if (!suggestOn || !hintsRef.current.length) return;
          if (e.key === "Tab") {
            e.preventDefault();
            e.stopPropagation();
            acceptHint(hintsRef.current[0]);
          } else if (e.key === "Escape") {
            setHints([]);
          }
        }}
      />
    </div>
  );

  function acceptHint(h: Suggestion) {
    const ed = edRef.current;
    const pos = ed?.getPosition();
    const model = ed?.getModel();
    if (!ed || !pos || !model) return;
    const line = model.getValueInRange({
      startLineNumber: pos.lineNumber,
      startColumn: 1,
      endLineNumber: pos.lineNumber,
      endColumn: pos.column,
    });
    const { prefix } = prefixAt(line);
    ed.executeEdits("anvil-suggest", [
      {
        range: {
          startLineNumber: pos.lineNumber,
          startColumn: Math.max(1, pos.column - prefix.length),
          endLineNumber: pos.lineNumber,
          endColumn: pos.column,
        },
        text: h.insert,
      },
    ]);
    setHints([]);
    ed.focus();
  }
}
