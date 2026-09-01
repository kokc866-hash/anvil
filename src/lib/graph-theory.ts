/** Gerichteter Graph G = (V, E). Pipeline, kein Netz. */

export type DiEdge = { from: string; to: string };
export type Digraph = { nodes: string[]; edges: DiEdge[] };

export function fromPairs(nodes: string[], edges: DiEdge[]): Digraph {
  const set = new Set(nodes);
  for (const e of edges) {
    set.add(e.from);
    set.add(e.to);
  }
  return { nodes: [...set], edges: edges.filter((e) => e.from !== e.to) };
}

export function outAdj(g: Digraph): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const id of g.nodes) m.set(id, []);
  for (const e of g.edges) m.get(e.from)?.push(e.to);
  return m;
}

export function degrees(g: Digraph): Map<string, { in: number; out: number }> {
  const m = new Map<string, { in: number; out: number }>();
  for (const id of g.nodes) m.set(id, { in: 0, out: 0 });
  for (const e of g.edges) {
    const a = m.get(e.from);
    const b = m.get(e.to);
    if (a) a.out += 1;
    if (b) b.in += 1;
  }
  return m;
}

/** DFS: true wenn ein gerichteter Kreis existiert. */
export function hasCycle(g: Digraph): boolean {
  const adj = outAdj(g);
  const mark = new Map<string, 0 | 1 | 2>();
  for (const id of g.nodes) mark.set(id, 0);
  const walk = (id: string): boolean => {
    mark.set(id, 1);
    for (const nxt of adj.get(id) ?? []) {
      const st = mark.get(nxt) ?? 0;
      if (st === 1) return true;
      if (st === 0 && walk(nxt)) return true;
    }
    mark.set(id, 2);
    return false;
  };
  for (const id of g.nodes) if (mark.get(id) === 0 && walk(id)) return true;
  return false;
}

/** Kahn. null bei Kreis. */
export function topoSort(g: Digraph): string[] | null {
  const deg = degrees(g);
  const adj = outAdj(g);
  const q = g.nodes.filter((id) => (deg.get(id)?.in ?? 0) === 0);
  const out: string[] = [];
  while (q.length) {
    const id = q.shift()!;
    out.push(id);
    for (const nxt of adj.get(id) ?? []) {
      const d = deg.get(nxt);
      if (!d) continue;
      d.in -= 1;
      if (d.in === 0) q.push(nxt);
    }
  }
  return out.length === g.nodes.length ? out : null;
}

/** Gerichtete Dichte: |E| / (|V|(|V|-1)). Baum ≈ 1/n, Netz → 1. */
export function density(g: Digraph): number {
  const n = g.nodes.length;
  if (n < 2) return 0;
  return g.edges.length / (n * (n - 1));
}

export function sources(g: Digraph): string[] {
  const d = degrees(g);
  return g.nodes.filter((id) => (d.get(id)?.in ?? 0) === 0);
}

export function sinks(g: Digraph): string[] {
  const d = degrees(g);
  return g.nodes.filter((id) => (d.get(id)?.out ?? 0) === 0);
}

/** Erreichbar von root (gerichtet). */
export function reachable(g: Digraph, root: string): Set<string> {
  const adj = outAdj(g);
  const seen = new Set<string>();
  const q = [root];
  while (q.length) {
    const id = q.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const nxt of adj.get(id) ?? []) q.push(nxt);
  }
  return seen;
}

/**
 * Arboreszenz: gerichteter Baum aus der Wurzel.
 * |E| = |V|-1, alle Knoten von root erreichbar, kein Kreis.
 */
export function isArborescence(g: Digraph, root: string): boolean {
  if (hasCycle(g)) return false;
  if (g.nodes.length && g.edges.length !== g.nodes.length - 1) return false;
  return reachable(g, root).size === g.nodes.length;
}

export type GraphKind = "empty" | "path" | "tree" | "dag" | "cyclic" | "dense";

export function classify(g: Digraph, root = "plan"): GraphKind {
  if (!g.nodes.length) return "empty";
  if (hasCycle(g)) return "cyclic";
  if (density(g) > 0.35) return "dense";
  if (isArborescence(g, root) || isArborescence(g, g.nodes[0] ?? root)) {
    const d = degrees(g);
    const branch = [...d.values()].some((x) => x.out > 1);
    return branch ? "tree" : "path";
  }
  return "dag";
}

export function wouldCycle(g: Digraph, from: string, to: string): boolean {
  if (from === to) return true;
  return hasCycle({ nodes: g.nodes, edges: [...g.edges, { from, to }] });
}
