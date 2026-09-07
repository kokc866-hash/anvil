import { addEdgeNode, BOARD_PATH, dumpBoard, rebuildBoardFromGraph, type Board, type BoardSettings } from "./harness-board.ts";
import { dumpGraph, dumpHarness, GRAPH_PATH, HARNESS_PATH, guessProjectHarness, type ProjectGraphEdge, type ProjectHarness } from "./harness-project.ts";

function readObject(files: Record<string, string>, path: string): Record<string, unknown> | undefined {
  if (!Object.hasOwn(files, path)) return;
  try {
    const value = JSON.parse(files[path]);
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch { /* Report before preparing any writes. */ }
  throw new Error(`${path} ist ungültig. Die vorhandene Datei wurde nicht verändert.`);
}

const edgeKey = (edge: ProjectGraphEdge) => JSON.stringify([edge.edge, edge.tool ?? "", edge.glob ?? ""]);

/** Update only the settings being edited; an existing board is never rebuilt here. */
export function projectSettingsWrites(
  files: Record<string, string>,
  patch: BoardSettings & Pick<ProjectHarness, "graphSees">,
  suggestion?: ReturnType<typeof guessProjectHarness>,
): Record<string, string> {
  const oldHarness = readObject(files, HARNESS_PATH);
  const oldGraph = readObject(files, GRAPH_PATH);
  const oldBoard = readObject(files, BOARD_PATH);
  if (oldGraph?.edges !== undefined && !Array.isArray(oldGraph.edges)) throw new Error(`${GRAPH_PATH}: Kantenliste ist ungültig.`);
  if (oldBoard && (!Array.isArray(oldBoard.nodes) || !Array.isArray(oldBoard.wires))) throw new Error(`${BOARD_PATH}: Tafel ist ungültig.`);
  const seed = suggestion ?? guessProjectHarness(files);
  const edges = [...((oldGraph?.edges ?? []) as ProjectGraphEdge[])];
  if (edges.some((edge) => !edge || typeof edge !== "object" || typeof edge.edge !== "string")) throw new Error(`${GRAPH_PATH}: Kante ist ungültig.`);
  const known = new Set(edges.map(edgeKey));
  const additions: ProjectGraphEdge[] = [];
  if (!oldGraph || suggestion) {
    for (const edge of seed.graph.edges ?? []) {
      if (known.has(edgeKey(edge))) continue;
      known.add(edgeKey(edge));
      edges.push(edge);
      additions.push(edge);
    }
  }
  const harness = { ...(oldHarness ? {} : seed.harness), ...oldHarness, ...patch };
  const writes: Record<string, string> = { [HARNESS_PATH]: dumpHarness(harness) };
  if (!oldGraph || additions.length) writes[GRAPH_PATH] = dumpGraph({ name: seed.graph.name, ...oldGraph, edges });
  if (!oldBoard) writes[BOARD_PATH] = dumpBoard(rebuildBoardFromGraph(edges, patch));
  else if (additions.length) {
    // Keep positions, camera, custom wires and extension fields. Add missing tools only.
    let board = oldBoard as unknown as Board;
    for (const edge of additions) {
      if (!board.nodes.some((node) => node.edge && edgeKey(node.edge) === edgeKey(edge))) board = addEdgeNode(board, edge);
    }
    writes[BOARD_PATH] = dumpBoard(board);
  }
  return writes;
}
