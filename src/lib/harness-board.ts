import type { AfterWrite, HarnessPhase } from "./harness.ts";
import { dumpGraph, dumpHarness, GRAPH_PATH, HARNESS_PATH, guessProjectHarness, loadProjectGraph, loadProjectHarness, type ProjectGraph, type ProjectGraphEdge, type ProjectHarness } from "./harness-project.ts";
import { classify, density, fromPairs, wouldCycle } from "./graph-theory.ts";

export const BOARD_PATH = ".anvil/board.json";
export const NODE_W = 156;
export const NODE_H = 62;

export type BoardKind = "phase" | "edge";
export type WireKind = "flow" | "fail" | "see" | "engine" | "graph";

export type BoardNode = {
  id: string;
  kind: BoardKind;
  x: number;
  y: number;
  label: string;
  phase?: HarnessPhase;
  edge?: ProjectGraphEdge;
};

export type BoardWire = {
  id: string;
  from: string;
  to: string;
  kind: WireKind;
  on: boolean;
};

export type BoardCam = { x: number; y: number; z: number };

export type Board = {
  cam: BoardCam;
  nodes: BoardNode[];
  wires: BoardWire[];
};

export type BoardSettings = {
  runLoop: boolean;
  graphLoop: boolean;
  testLoop?: boolean;
  engineLoop?: boolean;
  afterWrite: AfterWrite;
  loopTries: number;
  maxRounds: number;
};

const PHASES: { id: HarnessPhase; label: string; x: number; y: number }[] = [
  { id: "plan", label: "Plan", x: 48, y: 48 },
  { id: "act", label: "Arbeit", x: 248, y: 48 },
  { id: "observe", label: "Run", x: 448, y: 48 },
  { id: "done", label: "Fertig", x: 648, y: 48 },
  { id: "patch", label: "Patch", x: 248, y: 200 },
  { id: "see", label: "Vorschau", x: 448, y: 200 },
  { id: "engine", label: "Engine", x: 648, y: 200 },
];

const TOOL_Y = 320;
const SPINE: BoardWire[] = [
  { id: "plan-act", from: "plan", to: "act", kind: "flow", on: true },
  { id: "act-obs", from: "act", to: "observe", kind: "flow", on: true },
  { id: "obs-done", from: "observe", to: "done", kind: "flow", on: true },
  { id: "obs-see", from: "observe", to: "see", kind: "see", on: true },
  { id: "obs-patch", from: "observe", to: "patch", kind: "fail", on: true },
  { id: "obs-eng", from: "observe", to: "engine", kind: "engine", on: false },
];

/** Where a graph-tool hangs. Not always Run. */
export function sourcePhase(edge: ProjectGraphEdge, preferred?: string | null): string {
  if (preferred && PHASES.some((p) => p.id === preferred)) return preferred;
  const m: Record<string, string> = {
    preview: "see",
    play: "see",
    engine: "engine",
    test: "observe",
    run: "observe",
    format: "act",
    lint: "act",
    debug: "patch",
    mcp: "act",
    skill: "act",
    git: "done",
  };
  return m[edge.edge] ?? "act";
}

export function defaultBoard(s: BoardSettings): Board {
  const nodes: BoardNode[] = PHASES.map((p) => ({
    id: p.id,
    kind: "phase",
    x: p.x,
    y: p.y,
    label: p.label,
    phase: p.id,
  }));
  const wires: BoardWire[] = SPINE.map((w) =>
    w.id === "obs-eng" ? { ...w, on: Boolean(s.engineLoop) || s.afterWrite === "engine" } : { ...w },
  );
  return { cam: { x: 24, y: 16, z: 1 }, nodes, wires };
}

export function applySettings(board: Board, s: BoardSettings): Board {
  return {
    ...board,
    wires: board.wires.map((w) => {
      if (w.kind === "fail") return { ...w, on: s.runLoop };
      if (w.kind === "see") return { ...w, on: s.graphLoop };
      if (w.kind === "engine") return { ...w, on: Boolean(s.engineLoop) || s.afterWrite === "engine" };
      return w;
    }),
  };
}

export function toggleWire(board: Board, id: string): Board {
  const hit = board.wires.find((w) => w.id === id);
  if (!hit) return board;
  const on = !hit.on;
  const spine = SPINE.some((s) => s.id === id);
  if (spine && (hit.kind === "fail" || hit.kind === "see" || hit.kind === "engine")) {
    return {
      ...board,
      wires: board.wires.map((w) =>
        SPINE.some((s) => s.id === w.id) && w.kind === hit.kind ? { ...w, on } : w,
      ),
    };
  }
  return { ...board, wires: board.wires.map((w) => (w.id === id ? { ...w, on } : w)) };
}

export function compileBoard(board: Board, s: BoardSettings): { harness: ProjectHarness; graph: ProjectGraph } {
  const spineOn = (kind: WireKind) =>
    board.wires.some((w) => w.kind === kind && w.on && SPINE.some((x) => x.id === w.id));
  const fail = spineOn("fail");
  const see = spineOn("see");
  const eng = spineOn("engine");
  const afterWrite: AfterWrite = s.afterWrite ?? (eng && !fail ? "engine" : fail ? "run" : see ? "preview" : "none");
  const edges: ProjectGraphEdge[] = [];
  const seen = new Set<string>();
  const push = (e: ProjectGraphEdge) => {
    const k = `${e.edge}:${e.tool ?? ""}:${e.glob ?? ""}`;
    if (seen.has(k)) return;
    seen.add(k);
    edges.push(e);
  };
  for (const n of board.nodes) if (n.kind === "edge" && n.edge) push(n.edge);
  for (const w of board.wires) {
    if (!w.on || !SPINE.some((x) => x.id === w.id)) continue;
    const to = board.nodes.find((n) => n.id === w.to);
    if (w.kind === "see" || to?.phase === "see") {
      push({ when: "Vorschau nach Run", edge: "preview", tool: "see_run", glob: "*.{html,htm}" });
    }
    if (w.kind === "fail" || to?.phase === "patch") {
      push({ when: "Fehler → Patch → Run", edge: "run", tool: "run_file", glob: "*.{py,js,ts,tsx}" });
    }
    if (w.kind === "engine" || to?.phase === "engine") {
      push({ when: "Engine-Datei", edge: "engine", tool: "engine_run", glob: "*.{gd,cs,cpp,rs,godot}" });
    }
  }
  return {
    harness: {
      name: "board",
      when: "Tafel",
      runLoop: fail,
      graphLoop: see,
      engineLoop: eng,
      testLoop: Boolean(s.testLoop),
      loopTries: s.loopTries,
      maxRounds: s.maxRounds,
      afterWrite,
    },
    graph: { name: "board", edges },
  };
}

function wireKindOf(edge: ProjectGraphEdge): WireKind {
  if (edge.edge === "engine") return "engine";
  if (edge.edge === "preview" || edge.edge === "play") return "see";
  if (edge.edge === "test" || edge.edge === "run") return "fail";
  return "graph";
}

function placeUnder(board: Board, from: string, index: number): { x: number; y: number } {
  const src = board.nodes.find((n) => n.id === from);
  const col = PHASES.find((p) => p.id === from);
  const x = src?.x ?? col?.x ?? 48;
  const y0 = Math.max(TOOL_Y, (src?.y ?? 48) + NODE_H + 36);
  return { x, y: y0 + index * (NODE_H + 20) };
}

let edgeSeq = 0;
function nextNodeId(): string {
  edgeSeq += 1;
  return `e-${edgeSeq.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function addEdgeNode(board: Board, edge: ProjectGraphEdge, fromId?: string | null): Board {
  const from = sourcePhase(edge, fromId);
  const kids = board.wires.filter((w) => w.from === from && board.nodes.find((n) => n.id === w.to)?.kind === "edge").length;
  const pos = placeUnder(board, from, kids);
  const node: BoardNode = {
    id: nextNodeId(),
    kind: "edge",
    x: pos.x,
    y: pos.y,
    label: edge.glob || edge.tool || edge.edge,
    edge,
  };
  const wire: BoardWire = {
    id: `w-${node.id}`,
    from,
    to: node.id,
    kind: wireKindOf(edge),
    on: true,
  };
  return { ...board, nodes: [...board.nodes, node], wires: [...board.wires, wire] };
}

export function removeNode(board: Board, id: string): Board {
  const n = board.nodes.find((x) => x.id === id);
  if (!n || n.kind !== "edge") return board;
  return {
    ...board,
    nodes: board.nodes.filter((x) => x.id !== id),
    wires: board.wires.filter((w) => w.from !== id && w.to !== id),
  };
}

export function inferKind(from: BoardNode, to: BoardNode): WireKind {
  if (to.kind === "edge" && to.edge) return wireKindOf(to.edge);
  if (from.kind === "edge" && from.edge) return wireKindOf(from.edge);
  if (to.phase === "see" || from.phase === "see") return "see";
  if (to.phase === "patch" || from.phase === "patch") return "fail";
  if (to.phase === "engine" || from.phase === "engine") return "engine";
  return "flow";
}

export function boardGraph(board: Board) {
  return fromPairs(
    board.nodes.map((n) => n.id),
    board.wires.filter((w) => w.on).map((w) => ({ from: w.from, to: w.to })),
  );
}

export function connectNodes(board: Board, fromId: string, toId: string): Board {
  if (fromId === toId) return board;
  const from = board.nodes.find((n) => n.id === fromId);
  const to = board.nodes.find((n) => n.id === toId);
  if (!from || !to) return board;
  const hit = board.wires.find((w) => (w.from === fromId && w.to === toId) || (w.from === toId && w.to === fromId));
  if (hit) {
    if (hit.from === toId && hit.to === fromId) return board;
    return { ...board, wires: board.wires.map((w) => (w.id === hit.id ? { ...w, on: true } : w)) };
  }
  if (from.kind === "edge" && to.kind === "edge") return board;
  if (wouldCycle(boardGraph(board), fromId, toId)) return board;
  const kind = inferKind(from, to);
  return {
    ...board,
    wires: [...board.wires, { id: `w-${fromId}-${toId}-${Date.now().toString(36)}`, from: fromId, to: toId, kind, on: true }],
  };
}

export function removeWire(board: Board, id: string): Board {
  const w = board.wires.find((x) => x.id === id);
  if (!w) return board;
  if (w.id === "plan-act" || w.id === "act-obs" || w.id === "obs-done") {
    return { ...board, wires: board.wires.map((x) => (x.id === id ? { ...x, on: false } : x)) };
  }
  return { ...board, wires: board.wires.filter((x) => x.id !== id) };
}

export function mergeGraphNodes(board: Board, edges: ProjectGraphEdge[]): Board {
  const have = new Set(board.nodes.map((n) => `${n.edge?.tool ?? ""}:${n.edge?.glob ?? n.edge?.when ?? n.id}`));
  let next = board;
  for (const e of edges) {
    const k = `${e.tool ?? ""}:${e.glob ?? e.when}`;
    if (have.has(k)) continue;
    next = addEdgeNode(next, e);
    have.add(k);
  }
  return next;
}

export function resetLayout(_board: Board, s?: BoardSettings): Board {
  return defaultBoard(
    s ?? { runLoop: true, graphLoop: true, afterWrite: "run", loopTries: 3, maxRounds: 12 },
  );
}

export function fitCam(board: Board, vw: number, vh: number): BoardCam {
  if (!board.nodes.length) return { x: 0, y: 0, z: 1 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of board.nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + NODE_W);
    maxY = Math.max(maxY, n.y + NODE_H);
  }
  const bw = Math.max(80, maxX - minX + 80);
  const bh = Math.max(80, maxY - minY + 80);
  const z = Math.min(1.4, Math.max(0.5, Math.min((vw - 24) / bw, (vh - 24) / bh)));
  return { x: (vw - bw * z) / 2 - minX * z + 12, y: (vh - bh * z) / 2 - minY * z + 8, z };
}

const RANK: Record<string, number> = {
  plan: 0,
  act: 1,
  observe: 2,
  patch: 3,
  see: 3,
  engine: 3,
  done: 4,
};

function uniqueEdges(edges: ProjectGraphEdge[]): ProjectGraphEdge[] {
  const lane: Record<string, number> = {
    format: 0,
    lint: 1,
    mcp: 2,
    skill: 3,
    debug: 4,
    run: 5,
    test: 6,
    preview: 7,
    play: 8,
    engine: 9,
    git: 10,
  };
  const seen = new Set<string>();
  const out: ProjectGraphEdge[] = [];
  for (const e of edges) {
    const k = `${e.edge}:${e.tool ?? ""}:${e.glob ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  out.sort(
    (a, b) =>
      (lane[a.edge] ?? 20) - (lane[b.edge] ?? 20) ||
      (a.glob ?? "").localeCompare(b.glob ?? "") ||
      (a.tool ?? "").localeCompare(b.tool ?? ""),
  );
  return out;
}

/** Pipeline: spine → branches → leaves. No mesh, no reverse, no tool-to-tool. */
export function layoutPipeline(board: Board): Board {
  const pos = new Map(PHASES.map((p) => [p.id, p]));
  const nodes = board.nodes.map((n) => {
    if (n.kind !== "phase" || !n.phase) return n;
    const p = pos.get(n.phase);
    return p ? { ...n, x: p.x, y: p.y } : n;
  });
  const kids = new Map<string, BoardNode[]>();
  for (const n of nodes) {
    if (n.kind !== "edge" || !n.edge) continue;
    const from = sourcePhase(n.edge);
    const list = kids.get(from) ?? [];
    list.push(n);
    kids.set(from, list);
  }
  const placed = new Map<string, BoardNode>();
  for (const n of nodes) {
    if (n.kind === "phase") placed.set(n.id, n);
  }
  for (const [from, list] of kids) {
    list.forEach((n, i) => {
      const p = placeUnder({ ...board, nodes: [...placed.values()] }, from, i);
      placed.set(n.id, { ...n, x: p.x, y: p.y });
    });
  }
  return { ...board, nodes: nodes.map((n) => placed.get(n.id) ?? n) };
}

export function structureWires(board: Board): Board {
  const byId = new Map(board.nodes.map((n) => [n.id, n]));
  const prevOn = new Map(board.wires.map((w) => [w.id, w.on]));
  const wires: BoardWire[] = SPINE.map((s) => ({
    ...s,
    on: s.kind === "flow" ? true : (prevOn.get(s.id) ?? s.on),
  }));

  for (const n of board.nodes) {
    if (n.kind !== "edge" || !n.edge) continue;
    const from = sourcePhase(n.edge);
    if (!byId.has(from)) continue;
    wires.push({
      id: `w-${n.id}`,
      from,
      to: n.id,
      kind: wireKindOf(n.edge),
      on: prevOn.get(`w-${n.id}`) ?? true,
    });
  }

  for (const w of board.wires) {
    if (SPINE.some((s) => s.id === w.id)) continue;
    if (w.from === w.to) continue;
    const a = byId.get(w.from);
    const b = byId.get(w.to);
    if (!a || !b) continue;
    if (a.kind === "edge" || b.kind === "edge") continue;
    const ra = RANK[a.phase ?? a.id] ?? 9;
    const rb = RANK[b.phase ?? b.id] ?? 9;
    if (ra >= rb) continue;
    if (wires.some((x) => x.from === w.from && x.to === w.to)) continue;
    wires.push({ ...w, id: w.id || `w-${w.from}-${w.to}` });
  }

  const seen = new Set<string>();
  const clean = wires.filter((w) => {
    if (!byId.has(w.from) || !byId.has(w.to)) return false;
    const k = `${w.from}>${w.to}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { ...board, wires: clean };
}

export function tidyWires(board: Board): Board {
  return structureWires(board);
}

export function rebuildBoardFromGraph(edges: ProjectGraphEdge[], s: BoardSettings): Board {
  let board = defaultBoard(s);
  for (const e of uniqueEdges(edges)) board = addEdgeNode(board, e);
  board = layoutPipeline(board);
  board = structureWires(board);
  return applySettings(board, s);
}

export type Routed = { d: string; lx: number; ly: number; label: string };

const GAP = 12;

function lab(w: BoardWire): string {
  if (!w.on) return "";
  if (w.kind === "flow" || w.kind === "graph") return "";
  return WIRE_LABEL[w.kind];
}

export function routeAll(board: Board): Map<string, Routed> {
  const map = new Map<string, Routed>();
  const node = (id: string) => board.nodes.find((n) => n.id === id);
  const outgoing = new Map<string, BoardWire[]>();
  const incoming = new Map<string, BoardWire[]>();
  for (const w of board.wires) {
    if (!node(w.from) || !node(w.to)) continue;
    const o = outgoing.get(w.from) ?? [];
    o.push(w);
    outgoing.set(w.from, o);
    const i = incoming.get(w.to) ?? [];
    i.push(w);
    incoming.set(w.to, i);
  }
  for (const list of outgoing.values()) {
    list.sort((a, b) => (node(a.to)?.x ?? 0) - (node(b.to)?.x ?? 0) || a.id.localeCompare(b.id));
  }
  for (const list of incoming.values()) {
    list.sort((a, b) => (node(a.from)?.x ?? 0) - (node(b.from)?.x ?? 0) || a.id.localeCompare(b.id));
  }

  type Need = { w: BoardWire; a: BoardNode; b: BoardNode; ax: number; ay: number; bx: number; by: number; h: boolean };
  const needs: Need[] = [];
  for (const w of board.wires) {
    const a = node(w.from);
    const b = node(w.to);
    if (!a || !b) continue;
    const outs = outgoing.get(w.from) ?? [w];
    const ins = incoming.get(w.to) ?? [w];
    const fi = Math.max(0, outs.findIndex((x) => x.id === w.id));
    const ti = Math.max(0, ins.findIndex((x) => x.id === w.id));
    const ax = a.x + (NODE_W * (fi + 1)) / (outs.length + 1);
    const bx = b.x + (NODE_W * (ti + 1)) / (ins.length + 1);
    const h = Math.abs(a.y - b.y) < 30;
    needs.push({
      w,
      a,
      b,
      ax,
      ay: h ? a.y + NODE_H / 2 : a.y + NODE_H,
      bx,
      by: h ? b.y + NODE_H / 2 : b.y,
      h,
    });
  }

  const horiz = needs.filter((n) => n.h);
  for (const n of horiz) {
    const same = horiz.filter((x) => Math.abs(x.a.y - n.a.y) < 24);
    const idx = same.indexOf(n);
    const y = n.ay + (idx - (same.length - 1) / 2) * GAP;
    const x1 = n.a.x < n.b.x ? n.a.x + NODE_W : n.a.x;
    const x2 = n.a.x < n.b.x ? n.b.x : n.b.x + NODE_W;
    map.set(n.w.id, { d: `M ${x1} ${y} L ${x2} ${y}`, lx: (x1 + x2) / 2, ly: y, label: lab(n.w) });
  }

  const rest = needs.filter((n) => !n.h);
  const bands = new Map<string, Need[]>();
  for (const n of rest) {
    const key = `${Math.round(n.a.y / 20)}:${n.a.y < n.b.y ? "d" : "u"}`;
    const list = bands.get(key) ?? [];
    list.push(n);
    bands.set(key, list);
  }
  for (const group of bands.values()) {
    group.forEach((n, lane) => {
      const label = lab(n.w);
      const down = n.b.y >= n.a.y;
      const gap0 = down ? n.a.y + NODE_H : n.b.y + NODE_H;
      const gap1 = down ? n.b.y : n.a.y;
      const room = Math.max(GAP, gap1 - gap0);
      const midY = gap0 + Math.min(room - 10, 14 + lane * GAP);
      if (Math.abs(n.ax - n.bx) < 10) {
        map.set(n.w.id, { d: `M ${n.ax} ${n.ay} L ${n.bx} ${n.by}`, lx: n.ax, ly: (n.ay + n.by) / 2, label });
        return;
      }
      const d = down
        ? `M ${n.ax} ${n.ay} L ${n.ax} ${midY} L ${n.bx} ${midY} L ${n.bx} ${n.by}`
        : `M ${n.ax} ${n.ay} L ${n.ax} ${n.ay - 14 - lane * GAP} L ${n.bx} ${n.ay - 14 - lane * GAP} L ${n.bx} ${n.by}`;
      map.set(n.w.id, { d, lx: (n.ax + n.bx) / 2, ly: midY, label });
    });
  }

  const labeled = [...map.entries()].filter(([, r]) => r.label);
  const seenText = new Set<string>();
  for (const [id, r] of labeled) {
    if (seenText.has(r.label)) map.set(id, { ...r, label: "" });
    else seenText.add(r.label);
  }
  const shown = [...map.entries()].filter(([, r]) => r.label);
  for (let i = 0; i < shown.length; i++) {
    for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i][1];
      const b = shown[j][1];
      if (Math.hypot(a.lx - b.lx, a.ly - b.ly) < 42) map.set(shown[j][0], { ...b, label: "" });
    }
  }
  return map;
}

export function routeWire(board: Board, w: BoardWire): Routed | null {
  return routeAll(board).get(w.id) ?? null;
}

export function parseBoard(raw: string): Board | null {
  try {
    const j = JSON.parse(raw) as Board;
    if (!j?.nodes || !j?.wires) return null;
    return tidyWires({
      cam: { x: j.cam?.x ?? 24, y: j.cam?.y ?? 16, z: j.cam?.z ?? 1 },
      nodes: j.nodes,
      wires: j.wires.map((w) => ({ ...w, kind: w.kind || "flow", on: Boolean(w.on) })),
    });
  } catch {
    return null;
  }
}

export function dumpBoard(b: Board): string {
  return `${JSON.stringify(b, null, 2)}\n`;
}

export function filesFromBoard(board: Board, s: BoardSettings): Record<string, string> {
  const { harness, graph } = compileBoard(board, s);
  return {
    [HARNESS_PATH]: dumpHarness(harness),
    [GRAPH_PATH]: dumpGraph(graph),
    [BOARD_PATH]: dumpBoard(board),
  };
}

export const WIRE_LABEL: Record<WireKind, string> = {
  flow: "weiter",
  fail: "Patch",
  see: "Vorschau",
  engine: "Engine",
  graph: "Graph",
};

export const WIRE_COLOR: Record<WireKind, string> = {
  flow: "var(--color-muted)",
  fail: "var(--color-danger)",
  see: "var(--color-ok)",
  engine: "var(--color-ring)",
  graph: "var(--color-fg)",
};

export function boardSummary(board: Board): string {
  const g = boardGraph(board);
  const kind = classify(g, "plan");
  const label: Record<string, string> = {
    empty: "leer",
    path: "Pfad",
    tree: "Baum",
    dag: "DAG",
    cyclic: "Kreis",
    dense: "Netz",
  };
  const bits = [label[kind] ?? "DAG"];
  const on = (k: WireKind) => board.wires.some((w) => w.kind === k && w.on);
  if (on("fail")) bits.push("Patch");
  if (on("see")) bits.push("Vorschau");
  if (on("engine")) bits.push("Engine");
  const n = board.nodes.filter((x) => x.kind === "edge").length;
  if (n) bits.push(`${n} Blätter`);
  const d = density(g);
  if (d > 0.2) bits.push("dicht");
  return bits.join(" · ");
}

export function settingsFromFiles(files: Record<string, string>): BoardSettings {
  const h = loadProjectHarness(files);
  return {
    runLoop: h?.runLoop ?? true,
    graphLoop: Boolean(h?.graphLoop),
    testLoop: Boolean(h?.testLoop),
    engineLoop: Boolean(h?.engineLoop) || h?.afterWrite === "engine",
    afterWrite: h?.afterWrite ?? "run",
    loopTries: h?.loopTries ?? 3,
    maxRounds: h?.maxRounds ?? 12,
  };
}

function compactBoard(board: Board) {
  return {
    summary: boardSummary(board),
    nodes: board.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
      x: n.x,
      y: n.y,
      phase: n.phase,
      tool: n.edge?.tool,
      glob: n.edge?.glob,
      edge: n.edge?.edge,
    })),
    wires: board.wires.map((w) => ({ id: w.id, from: w.from, to: w.to, kind: w.kind, on: w.on })),
  };
}

function loadBoard(files: Record<string, string>, s: BoardSettings): Board {
  const parsed = files[BOARD_PATH] ? parseBoard(files[BOARD_PATH]) : null;
  return applySettings(parsed ?? defaultBoard(s), s);
}

export function applyBoardTool(
  name: string,
  args: Record<string, unknown>,
  files: Record<string, string>,
): { result: unknown; writes?: Record<string, string> } {
  const s = settingsFromFiles(files);
  let board = loadBoard(files, s);
  if (name === "board_read") {
    return { result: { ok: true, path: BOARD_PATH, ...compactBoard(board) } };
  }
  if (name === "board_open") {
    return { result: { ok: true, open: true, summary: boardSummary(board) } };
  }
  if (name === "board_reset") {
    board = defaultBoard(s);
    return { result: { ok: true, reset: true, ...compactBoard(board) }, writes: filesFromBoard(board, s) };
  }
  if (name === "board_write") {
    if (args.fromSources === true || args.rebuild === true) {
      const guessed = guessProjectHarness(files);
      const s2: BoardSettings = {
        ...s,
        afterWrite: guessed.harness.afterWrite ?? s.afterWrite,
        graphLoop: Boolean(guessed.harness.graphLoop),
        engineLoop: Boolean(guessed.harness.engineLoop) || guessed.harness.afterWrite === "engine",
      };
      board = rebuildBoardFromGraph(guessed.graph.edges ?? [], s2);
      return { result: { ok: true, fromSources: true, ...compactBoard(board) }, writes: filesFromBoard(board, s2) };
    }
    if (args.reset === true) board = defaultBoard(s);
    if (typeof args.json === "string") {
      const parsed = parseBoard(args.json);
      if (parsed) board = applySettings(parsed, s);
    } else if (args.board && typeof args.board === "object") {
      const parsed = parseBoard(JSON.stringify(args.board));
      if (parsed) board = applySettings(parsed, s);
    }
    if (Array.isArray(args.nodes)) board = { ...board, nodes: args.nodes as Board["nodes"] };
    if (Array.isArray(args.wires)) board = { ...board, wires: args.wires as Board["wires"] };
    const add = args.add && typeof args.add === "object" ? (args.add as Record<string, string>) : null;
    if (add) {
      board = addEdgeNode(
        board,
        {
          when: add.when || add.label || add.tool || "kante",
          edge: (add.edge as ProjectGraphEdge["edge"]) || "run",
          tool: add.tool,
          glob: add.glob || "*",
        },
        add.from,
      );
    }
    if (args.tool) {
      board = addEdgeNode(
        board,
        {
          when: String(args.when ?? args.tool),
          edge: (String(args.edge ?? "run") as ProjectGraphEdge["edge"]),
          tool: String(args.tool),
          glob: String(args.glob ?? "*"),
        },
        args.from != null ? String(args.from) : undefined,
      );
    }
    const from = args.from != null ? String(args.from) : args.connect && typeof args.connect === "object" ? String((args.connect as { from?: string }).from ?? "") : "";
    const to = args.to != null ? String(args.to) : args.connect && typeof args.connect === "object" ? String((args.connect as { to?: string }).to ?? "") : "";
    if (from && to && !args.tool && !add) board = connectNodes(board, from, to);
    if (args.remove) {
      const id = String(args.remove);
      board = board.nodes.some((n) => n.id === id) ? removeNode(board, id) : removeWire(board, id);
    }
    return { result: { ok: true, ...compactBoard(board) }, writes: filesFromBoard(board, s) };
  }
  return { result: { error: `unknown ${name}` } };
}

export function syncBoardSettings(files: Record<string, string>): Record<string, string> {
  const s = settingsFromFiles(files);
  const parsed = files[BOARD_PATH] ? parseBoard(files[BOARD_PATH]) : null;
  const board = applySettings(parsed ?? defaultBoard(s), s);
  return filesFromBoard(board, s);
}

export function syncBoardFromFiles(files: Record<string, string>): Record<string, string> {
  const s = settingsFromFiles(files);
  const g = loadProjectGraph(files);
  const board = rebuildBoardFromGraph(g?.edges ?? [], s);
  return filesFromBoard(board, s);
}
