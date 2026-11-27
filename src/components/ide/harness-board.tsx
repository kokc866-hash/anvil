import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, MoreHorizontal, Plus, Workflow, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useHelpTour } from "@/lib/help-guide";
import {
  addEdgeNode,
  applySettings,
  boardSummary,
  compileBoard,
  connectNodes,
  defaultBoard,
  filesFromBoard,
  fitCam,
  NODE_H,
  NODE_W,
  parseBoard,
  rebuildBoardFromGraph,
  removeNode,
  removeWire,
  routeAll,
  tidyWires,
  toggleWire,
  WIRE_COLOR,
  WIRE_LABEL,
  type Board,
  type BoardNode,
  type BoardWire,
  BOARD_PATH,
} from "@/lib/harness-board";
import { GRAPH_TOOLS, graphToolOf, projectEdgeCondition } from "@/lib/harness-graph";
import type { WorkflowNode, WorkflowStatus } from "@/lib/agent-workflow";
import { GRAPH_PATH, guessProjectHarness, loadProjectGraph, loadProjectHarness } from "@/lib/harness-project";
import { buildWorkflowRecipe, importWorkflowRecipe, recipeTargets, WORKFLOW_RECIPES, type WorkflowRecipeId } from "@/lib/workflow-recipes";
import { useIde } from "@/store/ide";
import { CtxMenu, FlyAt, type CtxItem } from "./ctx-menu";

export function HarnessBoard() {
  const files = useIde((s) => s.files);
  const grid = useIde((s) => s.harnessBoardGrid);
  const snap = useIde((s) => s.harnessBoardSnap);
  const motion = useIde((s) => s.motion);
  const live = useIde((s) => s.chat.at(-1)?.harness ?? "");
  const execution = useIde((s) => s.chat.at(-1)?.workflow);
  const busy = useIde((s) => s.agentBusy);
  const setOpen = useIde((s) => s.setHarnessBoardOpen);
  const setGrid = useIde((s) => s.setHarnessBoardGrid);
  const setSnap = useIde((s) => s.setHarnessBoardSnap);
  const writeFile = useIde((s) => s.writeFile);
  const setNotice = useIde((s) => s.setNotice);
  const setRunLoop = useIde((s) => s.setRunLoop);
  const setGraphLoop = useIde((s) => s.setGraphLoop);
  const setTestLoop = useIde((s) => s.setTestLoop);
  const setEngineLoop = useIde((s) => s.setEngineLoop);
  const setAfter = useIde((s) => s.setHarnessAfterWrite);
  const settings = useBoardSettings();
  const [showDetails, setShowDetails] = useState(false);
  const [toolbarMenu, setToolbarMenu] = useState<HTMLButtonElement | null>(null);

  const [board, setBoard] = useState<Board>(() => load(files, settings));
  const [sel, setSel] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [recipeId, setRecipeId] = useState<WorkflowRecipeId>("code-tests");
  const [recipeTarget, setRecipeTarget] = useState("");
  const [drag, setDrag] = useState<{ id?: string; px: number; py: number; ox: number; oy: number } | null>(null);
  const [link, setLink] = useState<{ from: string; x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; node?: string; wire?: string } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const undo = useRef<Board[]>([]);
  const redo = useRef<Board[]>([]);
  const boardRef = useRef(board);
  const dirtyRef = useRef(false);
  boardRef.current = board;
  dirtyRef.current = dirty;

  const livePhase = execution?.phase || live.split("·")[0]?.trim().toLowerCase() || "";

  const commit = useCallback((next: Board, hist = true) => {
    if (hist) {
      undo.current = [...undo.current.slice(-24), boardRef.current];
      redo.current = [];
    }
    setBoard(next);
    setDirty(true);
  }, []);

  const syncStore = useCallback(
    (b: Board) => {
      const c = compileBoard(b, settings);
      setRunLoop(Boolean(c.harness.runLoop));
      setGraphLoop(Boolean(c.harness.graphLoop));
      setTestLoop(Boolean(c.harness.testLoop));
      setEngineLoop(Boolean(c.harness.engineLoop));
      if (c.harness.afterWrite) setAfter(c.harness.afterWrite);
    },
    [settings, setRunLoop, setGraphLoop, setTestLoop, setEngineLoop, setAfter],
  );

  const save = useCallback(
    (b = boardRef.current) => {
      const pack = filesFromBoard(b, settings);
      writeFile(BOARD_PATH, pack[BOARD_PATH]);
      writeFile(".anvil/harness.json", pack[".anvil/harness.json"]);
      writeFile(GRAPH_PATH, pack[GRAPH_PATH]);
      syncStore(b);
      setDirty(false);
      setNotice("Tafel gespeichert");
    },
    [settings, writeFile, setNotice, syncStore],
  );

  useEffect(() => {
    setBoard((b) => applySettings(b, settings));
  }, [settings]);

  const boardSource = files[BOARD_PATH];
  useEffect(() => {
    if (dirty) return;
    if (!boardSource) return;
    const parsed = parseBoard(boardSource);
    if (parsed) setBoard(applySettings(parsed, settings));
  }, [boardSource, dirty, settings]);

  useEffect(() => {
    return () => {
      if (dirtyRef.current) save(boardRef.current);
    };
  }, [save]);

  useEffect(() => {
    function onWin(e: KeyboardEvent) {
      if (useHelpTour.getState().step !== null || (e.key === "Escape" && document.querySelector("[data-help-card]"))) return;
      if (e.target instanceof Element && e.target.closest('[role="menu"]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        save();
        return;
      }
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        const prev = undo.current.pop();
        if (!prev) return;
        e.preventDefault();
        redo.current = [...redo.current.slice(-24), boardRef.current];
        setBoard(prev);
        setDirty(true);
        return;
      }
      if ((mod && e.key.toLowerCase() === "z" && e.shiftKey) || (mod && e.key.toLowerCase() === "y")) {
        const nxt = redo.current.pop();
        if (!nxt) return;
        e.preventDefault();
        undo.current = [...undo.current.slice(-24), boardRef.current];
        setBoard(nxt);
        setDirty(true);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && sel) {
        const n = boardRef.current.nodes.find((x) => x.id === sel);
        const w = boardRef.current.wires.find((x) => x.id === sel);
        if (n?.kind === "edge") {
          e.preventDefault();
          commit(removeNode(boardRef.current, sel));
          setSel(null);
          return;
        }
        if (w) {
          e.preventDefault();
          commit(removeWire(boardRef.current, sel));
          setSel(null);
        }
      }
      if (e.key === "0" && !mod && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) {
        const b = boardRef.current;
        const r = stage.current?.getBoundingClientRect();
        setBoard({ ...b, cam: fitCam(b, r?.width ?? 800, r?.height ?? 480) });
      }
      if (e.key === "Escape") {
        if (menu) {
          e.preventDefault();
          setMenu(null);
          return;
        }
        if (link) {
          e.preventDefault();
          setLink(null);
          return;
        }
        if (sel) {
          e.preventDefault();
          e.stopPropagation();
          setSel(null);
        }
      }
    }
    window.addEventListener("keydown", onWin, true);
    return () => window.removeEventListener("keydown", onWin, true);
  }, [sel, link, menu, save, commit]);

  function worldOf(e: { clientX: number; clientY: number }) {
    const r = stage.current?.getBoundingClientRect();
    return {
      x: (e.clientX - (r?.left ?? 0) - board.cam.x) / board.cam.z,
      y: (e.clientY - (r?.top ?? 0) - board.cam.y) / board.cam.z,
    };
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const rect = stage.current?.getBoundingClientRect();
    const mx = e.clientX - (rect?.left ?? 0);
    const my = e.clientY - (rect?.top ?? 0);
    const z0 = board.cam.z;
    const z = Math.min(1.85, Math.max(0.42, z0 * (e.deltaY > 0 ? 0.9 : 1.11)));
    const x = mx - ((mx - board.cam.x) * z) / z0;
    const y = my - ((my - board.cam.y) * z) / z0;
    setBoard({ ...board, cam: { x, y, z } });
  }

  function finishLink(toId: string) {
    if (!link || link.from === toId) {
      setLink(null);
      return;
    }
    const next = connectNodes(board, link.from, toId);
    commit(next);
    syncStore(next);
    setLink(null);
    setSel(next.wires.at(-1)?.id ?? toId);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    setMenu(null);
    const el = e.target as HTMLElement;
    const port = el.closest("[data-port]")?.getAttribute("data-port");
    if (port) {
      e.stopPropagation();
      const n = board.nodes.find((x) => x.id === port);
      if (!n) return;
      if (link) {
        finishLink(port);
        return;
      }
      setSel(port);
      setLink({ from: port, x: n.x + NODE_W / 2, y: n.y + NODE_H / 2 });
      return;
    }
    const id = el.closest("[data-node]")?.getAttribute("data-node") ?? undefined;
    if (id) {
      if (link) {
        finishLink(id);
        return;
      }
      if (e.shiftKey) {
        const n = board.nodes.find((x) => x.id === id);
        if (!n) return;
        setSel(id);
        setLink({ from: id, x: n.x + NODE_W / 2, y: n.y + NODE_H / 2 });
        return;
      }
      const n = board.nodes.find((x) => x.id === id);
      if (!n) return;
      setSel(id);
      setDrag({ id, px: e.clientX, py: e.clientY, ox: n.x, oy: n.y });
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    const wid = el.dataset.wire;
    if (wid) {
      setSel(wid);
      return;
    }
    if (link) {
      setLink(null);
      return;
    }
    setSel(null);
    setDrag({ px: e.clientX, py: e.clientY, ox: board.cam.x, oy: board.cam.y });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (link) {
      const w = worldOf(e);
      setLink({ ...link, x: w.x, y: w.y });
      return;
    }
    if (!drag) return;
    if (drag.id) {
      const dx = (e.clientX - drag.px) / board.cam.z;
      const dy = (e.clientY - drag.py) / board.cam.z;
      let x = drag.ox + dx;
      let y = drag.oy + dy;
      if (snap) {
        x = Math.round(x / 24) * 24;
        y = Math.round(y / 24) * 24;
      }
      setBoard({ ...board, nodes: board.nodes.map((n) => (n.id === drag.id ? { ...n, x, y } : n)) });
      setDirty(true);
    } else {
      setBoard({ ...board, cam: { ...board.cam, x: drag.ox + (e.clientX - drag.px), y: drag.oy + (e.clientY - drag.py) } });
    }
  }

  function fit() {
    const r = stage.current?.getBoundingClientRect();
    setBoard({ ...board, cam: fitCam(board, r?.width ?? 800, r?.height ?? 480) });
  }

  function addKante(id?: string, fromId?: string) {
    const t = graphToolOf(id ?? "see_run") ?? GRAPH_TOOLS[0];
    const from = fromId ?? (selectedNode?.kind === "phase" ? selectedNode.id : undefined);
    commit(
      addEdgeNode(
        board,
        {
          when: t.label,
          edge: t.edge,
          tool: t.id,
          glob: t.glob ?? "*",
        },
        from,
      ),
    );
  }

  function startLinkFrom(id: string) {
    const n = board.nodes.find((x) => x.id === id);
    if (!n) return;
    setSel(id);
    setLink({ from: id, x: n.x + NODE_W / 2, y: n.y + NODE_H / 2 });
  }

  function toolItems(from?: string): CtxItem[] {
    const groups = [...new Set(GRAPH_TOOLS.map((t) => t.group))];
    const out: CtxItem[] = [];
    for (const g of groups) {
      if (out.length) out.push({ label: "", sep: true, onClick: () => undefined });
      for (const t of GRAPH_TOOLS.filter((x) => x.group === g)) {
        out.push({ label: t.label, onClick: () => addKante(t.id, from) });
      }
    }
    return out;
  }

  function boardMenu(): CtxItem[] {
    if (!menu) return [];
    const node = menu.node ? board.nodes.find((n) => n.id === menu.node) : undefined;
    const wire = menu.wire ? board.wires.find((w) => w.id === menu.wire) : undefined;
    const ask = (text: string) => useIde.getState().pushAgent(text);

    if (wire) {
      const backbone = wire.id === "plan-act" || wire.id === "act-obs" || wire.id === "obs-done";
      return [
        { label: wire.on ? "Verbindung deaktivieren" : "Verbindung aktivieren", onClick: () => { const next = toggleWire(board, wire.id); commit(next); syncStore(next); } },
        { label: "Name kopieren", onClick: () => void navigator.clipboard.writeText(WIRE_LABEL[wire.kind]) },
        { label: "Verbindung mit dem Agenten besprechen", onClick: () => ask(`Tafel: Leitung ${WIRE_LABEL[wire.kind]} (${wire.from} → ${wire.to}) ist ${wire.on ? "an" : "aus"}. Nutze oder erkläre sie.`) },
        { label: "", sep: true, onClick: () => undefined },
        { label: backbone ? "Hauptverbindung kann nicht entfernt werden" : "Verbindung entfernen", danger: !backbone, disabled: backbone, onClick: () => { if (!backbone) { commit(removeWire(board, wire.id)); setSel(null); } } },
      ];
    }

    if (node?.kind === "phase") {
      return [
        { label: "Verbindung erstellen", onClick: () => startLinkFrom(node.id) },
        { label: "Werkzeug zuordnen", items: toolItems(node.id) },
        { label: "", sep: true, onClick: () => undefined },
        { label: "Phase mit dem Agenten besprechen", onClick: () => ask(`Tafel-Phase ${node.label}. Was soll in diesem Schritt passieren? Kanten vorschlagen oder setzen.`) },
        { label: "Einpassen", onClick: () => fit() },
      ];
    }

    if (node?.kind === "edge") {
      const w = board.wires.find((x) => x.to === node.id);
      return [
        { label: "Verbindung erstellen", onClick: () => startLinkFrom(node.id) },
        { label: w?.on ? "Werkzeug deaktivieren" : "Werkzeug aktivieren", onClick: () => { if (w) { const next = toggleWire(board, w.id); commit(next); syncStore(next); } } },
        { label: "Duplizieren", onClick: () => node.edge && commit(addEdgeNode(board, { ...node.edge }, w?.from)) },
        { label: "Werkzeugname kopieren", onClick: () => void navigator.clipboard.writeText(node.edge?.tool ?? node.label) },
        { label: "", sep: true, onClick: () => undefined },
        { label: "Werkzeug mit dem Agenten besprechen", onClick: () => ask(`Tafel-Kante ${node.edge?.tool ?? node.label} (${node.edge?.glob ?? "*"}). Nutze sie im nächsten Lauf.`) },
        { label: "Knoten entfernen", danger: true, onClick: () => { commit(removeNode(board, node.id)); setSel(null); } },
      ];
    }

    return [
      { label: "Werkzeug hinzufügen", items: toolItems() },
      { label: "Ablauf vorschlagen", onClick: () => guess() },
      { label: "", sep: true, onClick: () => undefined },
      { label: grid ? "Raster aus" : "Raster an", onClick: () => setGrid(!grid) },
      { label: snap ? "Frei bewegen" : "Einrasten", onClick: () => setSnap(!snap) },
      { label: "Einpassen", onClick: () => fit() },
      { label: "Standard", onClick: () => { const next = defaultBoard(settings); commit(next); syncStore(next); } },
      { label: "", sep: true, onClick: () => undefined },
      { label: "Speichern", onClick: () => save() },
    ];
  }

  function guess() {
    const g = guessProjectHarness(files);
    const next = rebuildBoardFromGraph(g.graph.edges ?? [], {
      ...settings,
      afterWrite: g.harness.afterWrite ?? settings.afterWrite,
      graphLoop: Boolean(g.harness.graphLoop),
      engineLoop: Boolean(g.harness.engineLoop) || g.harness.afterWrite === "engine",
      testLoop: Boolean(g.harness.testLoop),
    });
    commit(next);
    syncStore(next);
    setNotice(`Vorgeschlagener Ablauf: ${g.harness.name ?? "Anwendung"}`);
  }

  const selectedNode = board.nodes.find((n) => n.id === sel);
  const selectedWire = board.wires.find((w) => w.id === sel);
  const pct = Math.round(board.cam.z * 100);
  const routes = useMemo(() => routeAll(board), [board]);
  const targets = useMemo(() => recipeTargets(recipeId, files), [recipeId, files]);
  const selectedTarget = targets.some(target => target.id === recipeTarget) ? recipeTarget : recipeId === "engine-check" && targets.length > 1 ? "" : targets[0]?.id || "";
  const recipe = useMemo(() => buildWorkflowRecipe(recipeId, files, selectedTarget || undefined), [recipeId, files, selectedTarget]);

  return (
    <div className="workflow-board flex h-full min-h-0 min-w-0 flex-col bg-bg" data-details={showDetails}>
      <div className="board-toolbar flex min-h-11 shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1">
        <Workflow className="size-4 shrink-0 text-muted" />
        <h2 className="text-xs font-medium tracking-wide text-muted uppercase">Tafel</h2>
        {dirty ? <span className="size-1.5 rounded-full bg-accent" title="ungespeichert" /> : null}
        <span className="board-summary min-w-0 truncate text-xs text-subtle">{boardSummary(board)}</span>
        <div className="flex-1" />
        <Button className="board-details-toggle h-8 px-2" variant="quiet" aria-controls="board-details" aria-expanded={showDetails}
          onClick={() => setShowDetails(!showDetails)}>{showDetails ? "Graph anzeigen" : "Details"}</Button>
        <Button className="h-8" variant="quiet" onClick={fit} title="Einpassen (0)">
          <Maximize2 className="size-3.5" />
        </Button>
        <Button className="board-add h-8" variant="quiet" onClick={() => addKante()}>
          <Plus className="size-3.5" /> Werkzeug
        </Button>
        <Button className="h-8" onClick={() => save()}>
          Speichern
        </Button>
        <Button className="size-8 p-0" variant="quiet" aria-label="Tafeloptionen" aria-haspopup="menu" aria-expanded={Boolean(toolbarMenu)} onClick={event => setToolbarMenu(event.currentTarget)}><MoreHorizontal className="size-4" /></Button>
        {toolbarMenu && <FlyAt anchor={toolbarMenu} within={toolbarMenu.closest<HTMLElement>(".workflow-board")} onClose={() => setToolbarMenu(null)}>
          {[
            {label: grid ? "Raster ausblenden" : "Raster anzeigen", run: () => setGrid(!grid)},
            {label: snap ? "Einrasten ausschalten" : "Einrasten einschalten", run: () => setSnap(!snap)},
            {label: "Werkzeug ergänzen", run: () => addKante()},
            {label: "Ablauf vorschlagen", run: guess},
            {label: "Standardablauf wiederherstellen", run: () => { const next = defaultBoard(settings); commit(next); syncStore(next); }},
          ].map(item => <button key={item.label} type="button" role="menuitem" className="block min-h-9 w-full px-3 py-1 text-left text-sm hover:bg-hover"
            onClick={() => { setToolbarMenu(null); item.run(); }}>{item.label}</button>)}
        </FlyAt>}
        <Button className="size-8 p-0" aria-label="Tafel schließen" variant="quiet" onClick={() => setOpen(false)}>
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div
          ref={stage}
          className={cn("board-canvas relative min-w-0 flex-1 overflow-hidden", link ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing")}
          style={{
            backgroundImage: grid ? "radial-gradient(circle, var(--color-border) 1px, transparent 1px)" : undefined,
            backgroundSize: "24px 24px",
          }}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => setDrag(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setDrag(null);
            const el = e.target as HTMLElement;
            const nid = el.closest("[data-node]")?.getAttribute("data-node") ?? undefined;
            const wid = el.closest("[data-wire]")?.getAttribute("data-wire") ?? el.dataset.wire ?? undefined;
            if (nid) setSel(nid);
            else if (wid) setSel(wid);
            else setSel(null);
            setMenu({ x: e.clientX, y: e.clientY, node: nid, wire: nid ? undefined : wid });
          }}
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest("[data-node],[data-wire]")) return;
            fit();
          }}
        >
          <div
            className="absolute inset-0 origin-top-left will-change-transform"
            style={{
              transform: `translate(${board.cam.x}px, ${board.cam.y}px) scale(${board.cam.z})`,
            }}
          >
            <svg className="pointer-events-none absolute overflow-visible" width="2400" height="1400" style={{ left: 0, top: 0 }}>
              <defs>
                {(["flow", "fail", "see", "engine", "graph"] as const).map((k) => (
                  <marker key={k} id={`arr-${k}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 Z" fill={WIRE_COLOR[k]} />
                  </marker>
                ))}
              </defs>
              {board.wires.map((w) => (
                <WireEl key={w.id} r={routes.get(w.id)} w={w} sel={sel === w.id} />
              ))}
              {link ? <Ghost from={board.nodes.find((n) => n.id === link.from)} x={link.x} y={link.y} /> : null}
            </svg>
            {board.nodes.map((n) => (
              <NodeEl
                key={n.id}
                n={n}
                sel={sel === n.id || link?.from === n.id}
                live={liveHits(n, livePhase)}
                pulse={busy && liveHits(n, livePhase) && motion !== "off"}
                linking={Boolean(link)}
                execution={execution?.nodes.find(node => node.id === n.id)}
              />
            ))}
          </div>
        </div>
        <aside id="board-details" aria-label="Graphdetails" className="board-inspector w-64 shrink-0 overflow-auto border-l border-border bg-surface p-3">
          {execution ? <div className="mb-4 border-b border-border pb-3" aria-label="Gesicherter Ablauf">
            <p className="text-xs font-medium text-fg">Aktueller Auftrag</p>
            <p className="mt-1 text-[11px] text-subtle">Prüfungen gelten für den bestätigten Dateistand. Änderungen können eine erneute Prüfung erfordern.</p>
            {execution.nodes.length ? <ul className="mt-2 space-y-2">{execution.nodes.slice(-12).map(node => <li key={node.id} className="text-[11px]">
              <button type="button" className="text-left text-fg hover:text-accent" onClick={() => { if (board.nodes.some(n => n.id === node.id)) setSel(node.id); }}>{node.label}</button>
              <span className={cn("ml-1", node.status === "failed" ? "text-danger" : "text-muted")}>{STATUS_TEXT[node.status]}</span>
              <p className="mt-0.5 break-words text-subtle">{node.path ? `${node.path} · ` : ""}{node.reason}</p>
            </li>)}</ul> : <p className="mt-2 text-[11px] text-muted">Noch keine Ausführungsprüfung.</p>}
            {execution.operations.some(op => op.status === "unclear") ? <p className="mt-2 text-[11px] text-danger">Ein Aktionsabschluss ist unbestätigt. Vor dem Wiederholen zuerst das Ergebnis prüfen.</p> : null}
          </div> : null}
          <details className="mb-3 border-b border-border pb-2">
            <summary className="cursor-pointer py-1 text-sm text-fg">Ablaufvorlagen</summary>
            <label htmlFor="workflow-recipe" className="mt-2 block text-sm text-muted">Ablaufvorlage</label>
            <select id="workflow-recipe" className="mt-2 w-full rounded border border-border bg-bg px-2 py-1.5 text-xs text-fg" value={recipeId} onChange={event => { setRecipeId(event.target.value as WorkflowRecipeId); setRecipeTarget(""); }}>
              {WORKFLOW_RECIPES.map(recipe => <option key={recipe.id} value={recipe.id}>{recipe.label}</option>)}
            </select>
            {targets.length ? <>
              <label htmlFor="workflow-recipe-target" className="mt-2 block text-[11px] text-muted">Projektziel</label>
              <select id="workflow-recipe-target" className="mt-1 w-full rounded border border-border bg-bg px-2 py-1.5 text-xs text-fg" value={selectedTarget} onChange={event => setRecipeTarget(event.target.value)}>
                {!selectedTarget ? <option value="">Ziel auswählen</option> : null}
                {targets.map(target => <option key={target.id} value={target.id}>{target.label}</option>)}
              </select>
            </> : null}
            <p className="mt-2 text-[11px] text-muted">Version {recipe.recipe.version} · {recipe.recipe.description}</p>
            <p className="mt-1 text-[11px] text-subtle">{recipe.recipe.requires}</p>
            {recipe.notes.map(note => <p key={note} className="mt-1 text-[11px] text-subtle">{note}</p>)}
            <Button className="mt-2 h-8 w-full" variant="quiet" disabled={!selectedTarget || !recipe.graph.edges?.some(edge => edge.enabled !== false)} onClick={() => {
              const next = importWorkflowRecipe(boardRef.current, recipe);
              commit(next);
              setSel(recipe.graph.edges?.find(edge => edge.enabled !== false)?.id || null);
              setNotice(`Vorlage „${recipe.recipe.label}“ (Version ${recipe.recipe.version}) ergänzt. Die bestehenden Freigaben und Einstellungen gelten weiter.`);
            }}>
              Vorlage ergänzen
            </Button>
          </details>
          <Inspector
            board={board}
            node={selectedNode}
            wire={selectedWire}
            tries={settings.loopTries}
            onPick={setSel}
            onAdd={addKante}
            onNode={(n) => commit({ ...board, nodes: board.nodes.map((x) => (x.id === n.id ? n : x)) })}
            onWire={(w) => {
              const cur = board.wires.find((x) => x.id === w.id);
              const next = cur && cur.on !== w.on ? toggleWire(board, w.id) : { ...board, wires: board.wires.map((x) => (x.id === w.id ? w : x)) };
              commit(next);
              syncStore(next);
            }}
            onDel={(id) => {
              const n = board.nodes.find((x) => x.id === id);
              if (n) commit(removeNode(board, id));
              else commit(removeWire(board, id));
              setSel(null);
            }}
          />
        </aside>
      </div>
      <div className="flex min-h-7 shrink-0 flex-wrap items-center gap-x-3 border-t border-border px-3 font-mono text-xs text-muted">
        <span>{pct}%</span>
        <span>{board.nodes.length} Knoten</span>
        <span>{board.wires.filter((w) => w.on).length}/{board.wires.length} Kanten an</span>
        <span className={cn("ml-auto", !link && !dirty && "board-summary")}>{link ? "Zielklick verbindet · Esc bricht ab" : dirty ? "ungespeichert · Ctrl+S" : "Rechtsklick · Port oder Shift+Klick verbindet"}</span>
      </div>
      {menu ? <CtxMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={boardMenu()} /> : null}
    </div>
  );
}

function liveHits(n: BoardNode, phase: string) {
  if (!n.phase) return false;
  const map: Record<string, string> = {
    plan: "plan",
    arbeit: "act",
    run: "observe",
    patch: "patch",
    vorschau: "see",
    engine: "engine",
    fertig: "done",
    stop: "abort",
  };
  return (map[phase] || phase) === n.phase;
}

const STATUS_TEXT: Record<WorkflowStatus, string> = { ready: "Bereit", running: "Läuft", passed: "Bestätigt", failed: "Fehlgeschlagen", waiting: "Wartet auf Nachweis", disabled: "Nicht verfügbar", stale: "Erneut prüfen", retried: "Wiederholung bestätigt" };

function NodeEl({ n, sel, live, pulse, linking, execution }: { n: BoardNode; sel: boolean; live: boolean; pulse: boolean; linking?: boolean; execution?: WorkflowNode }) {
  const tool = n.kind === "edge" ? n.edge?.tool : undefined;
  const ports = [
    { k: "t", x: NODE_W / 2, y: 0 },
    { k: "b", x: NODE_W / 2, y: NODE_H },
    { k: "l", x: 0, y: NODE_H / 2 },
    { k: "r", x: NODE_W, y: NODE_H / 2 },
  ];
  return (
    <div
      data-node={n.id}
      className={cn(
        "group absolute cursor-grab rounded-md border bg-surface px-3 py-2 select-none",
        sel ? "border-accent" : "border-border",
        live ? "ring-1 ring-ring" : "",
        pulse ? "shadow-[0_0_0_3px_var(--color-ring)]" : "",
        n.kind === "edge" ? "border-dashed" : "",
        linking ? "cursor-crosshair" : "",
      )}
      style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
    >
      <p className="truncate text-sm text-fg">{n.label}</p>
      {tool ? <p className="truncate font-mono text-[10px] text-subtle" title={execution?.reason}>{execution ? STATUS_TEXT[execution.status] : tool}</p> : null}
      {ports.map((p) => (
        <button
          key={p.k}
          type="button"
          data-port={n.id}
          title="Verbindung erstellen"
          className={cn(
            "absolute z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent bg-surface hover:scale-150",
            linking || sel ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
          style={{ left: p.x, top: p.y }}
        />
      ))}
    </div>
  );
}

function Ghost({ from, x, y }: { from?: BoardNode; x: number; y: number }) {
  if (!from) return null;
  const x1 = from.x + NODE_W / 2;
  const y1 = from.y + NODE_H / 2;
  return <path d={`M ${x1} ${y1} L ${x} ${y}`} fill="none" stroke="var(--color-accent)" strokeWidth={1.6} strokeDasharray="5 4" />;
}

function WireEl({ r, w, sel }: { r?: { d: string; lx: number; ly: number; label: string }; w: BoardWire; sel: boolean }) {
  if (!r) return null;
  const color = w.on ? (sel ? "var(--color-fg)" : WIRE_COLOR[w.kind]) : "var(--color-border)";
  const show = Boolean(r.label) && (w.on || sel);
  const tw = Math.max(36, r.label.length * 6.2 + 10);
  return (
    <g className="pointer-events-auto">
      <path d={r.d} fill="none" stroke={color} strokeWidth={sel ? 2.4 : w.on ? 1.6 : 1.1} strokeDasharray={w.on ? undefined : "5 5"} strokeLinejoin="round" strokeLinecap="round" markerEnd={w.on ? `url(#arr-${w.kind})` : undefined} />
      <path d={r.d} fill="none" stroke="transparent" strokeWidth={16} data-wire={w.id} className="cursor-pointer" />
      {show ? (
        <>
          <rect
            x={r.lx - tw / 2}
            y={r.ly - 9}
            width={tw}
            height={18}
            rx={4}
            fill="var(--color-surface)"
            stroke={color}
            strokeWidth={1}
          />
          <text
            x={r.lx}
            y={r.ly + 4}
            textAnchor="middle"
            fill="var(--color-fg)"
            fontSize="10"
            fontWeight={500}
            className="pointer-events-none"
            style={{ fontFamily: "inherit" }}
          >
            {r.label}
          </text>
        </>
      ) : null}
    </g>
  );
}

const PHASE_LIST: { id: string; label: string }[] = [
  { id: "plan", label: "Plan" },
  { id: "act", label: "Arbeit" },
  { id: "observe", label: "Ausführung" },
  { id: "done", label: "Fertig" },
  { id: "see", label: "Vorschau" },
  { id: "patch", label: "Korrektur" },
  { id: "engine", label: "Engine" },
];

function Inspector({
  board,
  node,
  wire,
  tries,
  onPick,
  onAdd,
  onNode,
  onWire,
  onDel,
}: {
  board: Board;
  node?: BoardNode;
  wire?: BoardWire;
  tries: number;
  onPick: (id: string) => void;
  onAdd: (id: string) => void;
  onNode: (n: BoardNode) => void;
  onWire: (w: BoardWire) => void;
  onDel: (id: string) => void;
}) {
  const onKind = (k: string) => board.wires.some((w) => (w.to === k || w.from === k) && w.on);
  function Phasen() {
    return (
      <div className="mb-3">
        <p className="text-xs text-muted">Phasen</p>
        <p className="mt-0.5 mb-1.5 text-[11px] text-subtle">Klicke auf den Punkt am Knoten oder mit Umschalt auf den Knoten. Wähle danach das Verbindungsziel. Mit Esc brichst du ab.</p>
        <div className="flex flex-wrap gap-1">
          {PHASE_LIST.map((p) => (
            <button
              key={p.id}
              type="button"
              className={cn(
                "min-h-8 rounded-md border px-2 text-sm",
                node?.id === p.id ? "border-accent text-fg" : onKind(p.id) ? "border-border text-fg" : "border-border text-muted hover:text-fg",
              )}
              aria-pressed={node?.id === p.id}
              onClick={() => onPick(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
  function Tools() {
    const groups = [...new Set(GRAPH_TOOLS.map((t) => t.group))];
    return (
      <details>
        <summary className="cursor-pointer py-1.5 text-sm text-fg">Graph-Werkzeuge</summary>
        <p className="mt-1 mb-2 text-[11px] text-subtle">Hier ergänzt du Werkzeuge für die einzelnen Phasen. Die Phasen selbst wählst du oben.</p>
        {groups.map((g) => (
          <div key={g} className="mb-2">
            <p className="text-[10px] tracking-wide text-subtle uppercase">{g}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {GRAPH_TOOLS.filter((t) => t.group === g).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  title={t.hint}
                  className="min-h-8 rounded-md border border-border px-2 text-sm text-muted hover:text-fg"
                  onClick={() => onAdd(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </details>
    );
  }
  if (wire) {
    return (
      <div>
        <Phasen />
        <p className="text-xs text-muted">Kante</p>
        <p className="mt-1 text-sm text-fg">{WIRE_LABEL[wire.kind]}</p>
        <label className="mt-3 flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={wire.on} onChange={(e) => onWire({ ...wire, on: e.target.checked })} /> Aktiv
        </label>
        <button type="button" className="mt-3 text-[11px] text-danger" onClick={() => onDel(wire.id)}>
          Verbindung entfernen
        </button>
      </div>
    );
  }
  if (!node) {
    return (
      <div>
        <Phasen />
        <Tools />
      </div>
    );
  }
  if (node.kind === "phase") {
    return (
      <div>
        <Phasen />
        <p className="text-xs text-muted">Phase</p>
        <p className="mt-1 text-sm text-fg">{node.label}</p>
        <p className="mt-2 mb-3 text-[11px] text-subtle">
          {node.phase === "observe" ? `Führt das Programm aus. Bei Fehlern sind bis zu ${tries} Korrekturversuche vorgesehen.` : "Die unten gewählten Graph-Werkzeuge werden dieser Phase zugeordnet."}
        </p>
        <Tools />
      </div>
    );
  }
  const e = node.edge!;
  return (
    <div className="space-y-2">
      <Phasen />
      <p className="text-xs text-muted">Graph-Kante</p>
      <label className="block text-[11px] text-subtle">
        Beschreibung
        <input
          value={e.when}
          className="mt-0.5 h-8 w-full rounded-md border border-border bg-bg px-2 text-xs text-fg"
          onChange={(ev) => onNode({ ...node, edge: { ...e, when: ev.target.value } })}
        />
      </label>
      <label className="block text-[11px] text-subtle">
        Auslöser
        <select value={projectEdgeCondition(e)} className="mt-0.5 h-8 w-full rounded-md border border-border bg-bg px-2 text-xs text-fg" onChange={ev => onNode({ ...node, edge: { ...e, condition: ev.target.value as typeof e.condition } })}>
          <option value="changed">Nach Dateiänderung</option><option value="success">Nach erfolgreicher Ausführung</option><option value="failure">Nach fehlgeschlagener Prüfung</option><option value="tests-passed">Nach bestandenen Tests</option><option value="manual">Nur auf Auftrag des Agenten</option>
        </select>
      </label>
      <p className="text-[11px] text-subtle">Die Beschreibung erteilt keine Freigabe. Dienste, Git und Interaktionen benötigen einen ausdrücklichen Werkzeugaufruf.</p>
      <label className="block text-[11px] text-subtle">
        Dateimuster
        <input
          value={e.glob ?? ""}
          className="mt-0.5 h-8 w-full rounded-md border border-border bg-bg px-2 font-mono text-xs text-fg"
          onChange={(ev) => onNode({ ...node, label: ev.target.value || e.tool || e.edge, edge: { ...e, glob: ev.target.value } })}
        />
      </label>
      <label className="block text-[11px] text-subtle">
        Werkzeug
        <select
          value={e.tool ?? "run_file"}
          className="mt-0.5 h-8 w-full rounded-md border border-border bg-bg px-2 text-xs text-fg"
          onChange={(ev) => {
            const t = graphToolOf(ev.target.value);
            onNode({
              ...node,
              label: t?.glob ?? t?.label ?? ev.target.value,
              edge: { ...e, tool: ev.target.value, edge: t?.edge ?? e.edge, glob: e.glob || t?.glob, when: e.when || (t?.label ?? e.when) },
            });
          }}
        >
          {GRAPH_TOOLS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.group} · {t.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="text-[11px] text-danger" onClick={() => onDel(node.id)}>
        Knoten entfernen
      </button>
    </div>
  );
}

function useBoardSettings() {
  const runLoop = useIde((s) => s.runLoop);
  const graphLoop = useIde((s) => s.graphLoop);
  const testLoop = useIde((s) => s.testLoop);
  const engineLoop = useIde((s) => s.engineLoop);
  const afterWrite = useIde((s) => s.harnessAfterWrite);
  const loopTries = useIde((s) => s.loopTries);
  const maxRounds = useIde((s) => s.harnessMaxRounds);
  return useMemo(
    () => ({
      runLoop,
      graphLoop,
      testLoop,
      engineLoop: Boolean(engineLoop) || afterWrite === "engine",
      afterWrite: afterWrite ?? "run",
      loopTries,
      maxRounds: maxRounds ?? 12,
    }),
    [runLoop, graphLoop, testLoop, engineLoop, afterWrite, loopTries, maxRounds],
  );
}

function load(files: Record<string, string>, s: ReturnType<typeof useBoardSettings>): Board {
  const raw = files[BOARD_PATH];
  const parsed = raw ? parseBoard(raw) : null;
  if (raw && !parsed) {
    void import("@/lib/intern").then((m) => m.note("board", "board.json unlesbar"));
  }
  let b = applySettings(parsed ?? defaultBoard(s), s);
  b = tidyWires(b);
  const g = loadProjectGraph(files);
  if (g?.edges?.length && !parsed) b = rebuildBoardFromGraph(g.edges, s, g);
  const h = loadProjectHarness(files);
  if (h) {
    b = applySettings(b, {
      runLoop: h.runLoop ?? s.runLoop,
      graphLoop: h.graphLoop ?? s.graphLoop,
      testLoop: h.testLoop ?? s.testLoop,
      engineLoop: Boolean(h.engineLoop) || h.afterWrite === "engine",
      afterWrite: h.afterWrite ?? s.afterWrite,
      loopTries: h.loopTries ?? s.loopTries,
      maxRounds: h.maxRounds ?? s.maxRounds,
    });
  }
  return b;
}
