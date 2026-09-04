import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Plus, RotateCcw, Workflow, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
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
import { GRAPH_TOOLS, graphToolOf } from "@/lib/harness-graph";
import { GRAPH_PATH, guessProjectHarness, loadProjectGraph, loadProjectHarness } from "@/lib/harness-project";
import { useIde } from "@/store/ide";
import { CtxMenu, type CtxItem } from "./ctx-menu";

export function HarnessBoard() {
  const files = useIde((s) => s.files);
  const grid = useIde((s) => s.harnessBoardGrid);
  const snap = useIde((s) => s.harnessBoardSnap);
  const motion = useIde((s) => s.motion);
  const live = useIde((s) => s.chat.at(-1)?.harness ?? "");
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

  const [board, setBoard] = useState<Board>(() => load(files, settings));
  const [sel, setSel] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
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

  const livePhase = live.split("·")[0]?.trim().toLowerCase() ?? "";

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
  }, [settings.runLoop, settings.graphLoop, settings.afterWrite, settings.engineLoop]);

  useEffect(() => {
    if (dirty) return;
    const raw = files[BOARD_PATH];
    if (!raw) return;
    const parsed = parseBoard(raw);
    if (parsed) setBoard(applySettings(parsed, settings));
  }, [files[BOARD_PATH]]);

  useEffect(() => {
    return () => {
      if (dirtyRef.current) save(boardRef.current);
    };
  }, [save]);

  useEffect(() => {
    function onWin(e: KeyboardEvent) {
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
        { label: wire.on ? "Leitung aus" : "Leitung an", onClick: () => { const next = toggleWire(board, wire.id); commit(next); syncStore(next); } },
        { label: "Name kopieren", onClick: () => void navigator.clipboard.writeText(WIRE_LABEL[wire.kind]) },
        { label: "Agent: diese Leitung", onClick: () => ask(`Tafel: Leitung ${WIRE_LABEL[wire.kind]} (${wire.from} → ${wire.to}) ist ${wire.on ? "an" : "aus"}. Nutze oder erkläre sie.`) },
        { label: "", sep: true, onClick: () => undefined },
        { label: backbone ? "Hauptleitung bleibt" : "Leitung weg", danger: !backbone, disabled: backbone, onClick: () => { if (!backbone) { commit(removeWire(board, wire.id)); setSel(null); } } },
      ];
    }

    if (node?.kind === "phase") {
      return [
        { label: "Leitung ziehen", onClick: () => startLinkFrom(node.id) },
        { label: "Kante hier", items: toolItems(node.id) },
        { label: "", sep: true, onClick: () => undefined },
        { label: "Agent: diese Phase", onClick: () => ask(`Tafel-Phase ${node.label}. Was soll in diesem Schritt passieren? Kanten vorschlagen oder setzen.`) },
        { label: "Einpassen", onClick: () => fit() },
      ];
    }

    if (node?.kind === "edge") {
      const w = board.wires.find((x) => x.to === node.id);
      return [
        { label: "Leitung ziehen", onClick: () => startLinkFrom(node.id) },
        { label: w?.on ? "Kante aus" : "Kante an", onClick: () => { if (w) { const next = toggleWire(board, w.id); commit(next); syncStore(next); } } },
        { label: "Duplizieren", onClick: () => node.edge && commit(addEdgeNode(board, { ...node.edge }, w?.from)) },
        { label: "Tool kopieren", onClick: () => void navigator.clipboard.writeText(node.edge?.tool ?? node.label) },
        { label: "", sep: true, onClick: () => undefined },
        { label: "Agent: diese Kante", onClick: () => ask(`Tafel-Kante ${node.edge?.tool ?? node.label} (${node.edge?.glob ?? "*"}). Nutze sie im nächsten Lauf.`) },
        { label: "Knoten weg", danger: true, onClick: () => { commit(removeNode(board, node.id)); setSel(null); } },
      ];
    }

    return [
      { label: "Kante anlegen", items: toolItems() },
      { label: "Raten", onClick: () => guess() },
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
    setNotice(`Pipeline: ${g.harness.name ?? "app"}`);
  }

  const selectedNode = board.nodes.find((n) => n.id === sel);
  const selectedWire = board.wires.find((w) => w.id === sel);
  const pct = Math.round(board.cam.z * 100);
  const routes = useMemo(() => routeAll(board), [board]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <Workflow className="size-4 text-muted" />
        <h2 className="text-xs font-medium tracking-wide text-muted uppercase">Tafel</h2>
        {dirty ? <span className="size-1.5 rounded-full bg-accent" title="ungespeichert" /> : null}
        <span className="hidden truncate text-[11px] text-subtle sm:inline">{boardSummary(board)}</span>
        <div className="flex-1" />
        <Button className="h-8" variant="quiet" onClick={() => setGrid(!grid)} title="Raster">
          {grid ? "Raster" : "ohne Raster"}
        </Button>
        <Button className="h-8" variant="quiet" onClick={() => setSnap(!snap)} title="Einrasten">
          {snap ? "einrasten" : "frei"}
        </Button>
        <Button className="h-8" variant="quiet" onClick={fit} title="Einpassen (0)">
          <Maximize2 className="size-3.5" />
        </Button>
        <Button className="h-8" variant="quiet" onClick={() => { const next = defaultBoard(settings); commit(next); syncStore(next); }} title="Standard wie am Anfang">
          <RotateCcw className="size-3.5" />
          Standard
        </Button>
        <Button className="h-8" variant="quiet" onClick={guess}>
          Raten
        </Button>
        <Button className="h-8" variant="quiet" onClick={() => addKante()}>
          <Plus className="size-3.5" /> Kante
        </Button>
        <Button className="h-8" onClick={() => save()}>
          Speichern
        </Button>
        <Button className="h-8" variant="quiet" onClick={() => setOpen(false)}>
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div
          ref={stage}
          className={cn("relative min-w-0 flex-1 overflow-hidden", link ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing")}
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
              />
            ))}
          </div>
        </div>
        <aside className="w-60 shrink-0 overflow-auto border-l border-border bg-surface p-3">
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
      <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border px-3 font-mono text-[10px] text-subtle">
        <span>{pct}%</span>
        <span>{board.nodes.length} Knoten</span>
        <span>{board.wires.filter((w) => w.on).length}/{board.wires.length} Kanten an</span>
        <span className="ml-auto">{link ? "Zielklick verbindet · Esc bricht ab" : dirty ? "ungespeichert · Ctrl+S" : "Rechtsklick · Port oder Shift+Klick verbindet"}</span>
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
  return map[phase] === n.phase;
}

function NodeEl({ n, sel, live, pulse, linking }: { n: BoardNode; sel: boolean; live: boolean; pulse: boolean; linking?: boolean }) {
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
      {tool ? <p className="truncate font-mono text-[10px] text-subtle">{tool}</p> : null}
      {ports.map((p) => (
        <button
          key={p.k}
          type="button"
          data-port={n.id}
          title="Leitung ziehen"
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
  { id: "observe", label: "Run" },
  { id: "done", label: "Fertig" },
  { id: "see", label: "Vorschau" },
  { id: "patch", label: "Patch" },
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
        <p className="mt-0.5 mb-1.5 text-[11px] text-subtle">Punkt am Knoten oder Shift+Klick, dann Ziel. Esc bricht ab.</p>
        <div className="flex flex-wrap gap-1">
          {PHASE_LIST.map((p) => (
            <button
              key={p.id}
              type="button"
              className={cn(
                "h-7 rounded-md border px-1.5 text-[10px]",
                node?.id === p.id ? "border-accent text-fg" : onKind(p.id) ? "border-border text-fg" : "border-border text-muted hover:text-fg",
              )}
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
      <div>
        <p className="text-xs text-muted">Graph-Tools</p>
        <p className="mt-1 mb-2 text-[11px] text-subtle">Zusatzkanten. Nicht Plan/Arbeit/Fertig — die sind oben.</p>
        {groups.map((g) => (
          <div key={g} className="mb-2">
            <p className="text-[10px] tracking-wide text-subtle uppercase">{g}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {GRAPH_TOOLS.filter((t) => t.group === g).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  title={t.hint}
                  className="h-7 rounded-md border border-border px-1.5 text-[10px] text-muted hover:text-fg"
                  onClick={() => onAdd(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (wire) {
    return (
      <div>
        <Phasen />
        <p className="text-xs text-muted">Kante</p>
        <p className="mt-1 text-sm text-fg">{WIRE_LABEL[wire.kind]}</p>
        <label className="mt-3 flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={wire.on} onChange={(e) => onWire({ ...wire, on: e.target.checked })} /> an
        </label>
        <button type="button" className="mt-3 text-[11px] text-danger" onClick={() => onDel(wire.id)}>
          Leitung weg
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
          {node.phase === "observe" ? `Run. Bei Fehler bis ${tries}× Patch.` : "Graph-Tools unten hängen an dieser Phase."}
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
        wenn
        <input
          value={e.when}
          className="mt-0.5 h-8 w-full rounded-md border border-border bg-bg px-2 text-xs text-fg"
          onChange={(ev) => onNode({ ...node, edge: { ...e, when: ev.target.value } })}
        />
      </label>
      <label className="block text-[11px] text-subtle">
        glob
        <input
          value={e.glob ?? ""}
          className="mt-0.5 h-8 w-full rounded-md border border-border bg-bg px-2 font-mono text-xs text-fg"
          onChange={(ev) => onNode({ ...node, label: ev.target.value || e.tool || e.edge, edge: { ...e, glob: ev.target.value } })}
        />
      </label>
      <label className="block text-[11px] text-subtle">
        tool
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
        Knoten weg
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
  if (g?.edges?.length && !parsed) b = rebuildBoardFromGraph(g.edges, s);
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
