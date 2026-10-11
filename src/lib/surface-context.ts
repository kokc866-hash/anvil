import { useIde } from "@/store/ide";
import { ANVIL_SURFACE, surfaceLabel, surfacePrompt, type SurfaceSnap } from "./surface";
import { mcpProbe, mcpRefresh, mcpSnapshot, mcpListError, mcpConfigured } from "./mcp";
import { captureAgentRun, type AgentRun } from "./agent-run";
import { requestPhase } from "./request-state";

export async function surfaceNote(run: AgentRun = captureAgentRun()): Promise<{ text: string; id: string; mode: SurfaceSnap["mode"] }> {
  run.assertCurrent();
  const st = useIde.getState();
  const id = st.activeSurfaceId || ANVIL_SURFACE;
  const mode = st.surfaceMode === "bridge" ? "bridge" : "exclusive";
  const servers = st.mcpServers ?? [];
  const selected = servers.find((s) => s.id === id);
  let snapshot = mcpSnapshot(servers);
  if (id !== ANVIL_SURFACE && selected?.enabled && !snapshot.ready.has(selected.id)) {
    requestPhase(run.generation, "catalog", selected.name || selected.id);
    await run.wait(mcpProbe(selected, servers, run.signal));
    snapshot = mcpSnapshot(servers);
  } else if (servers.some(mcpConfigured)) {
    // Refresh alongside the model request. A stale server does not block ordinary chat.
    void mcpRefresh(servers, 60000, run.signal).catch(() => undefined);
  }
  const snap: SurfaceSnap = {
    id,
    mode,
    label: surfaceLabel(id, servers),
    tools: id === ANVIL_SURFACE ? snapshot.tools : snapshot.tools.filter((tool) => tool.serverId === id),
    resources:
      id === ANVIL_SURFACE
        ? snapshot.resources
        : snapshot.resources.filter((r) => r.server === id || r.server === selected?.name),
    context: selected?.context ?? {},
    ready: id === ANVIL_SURFACE || Boolean(selected?.enabled && snapshot.ready.has(id)),
    view: st.mcpView[id]?.text,
    error: selected ? mcpListError(selected.id) : undefined,
    servers: servers.filter(mcpConfigured).map((s) => ({ id: s.id, name: s.name, ready: snapshot.ready.has(s.id), error: mcpListError(s.id) })),
  };
  return { text: surfacePrompt(snap), id, mode };
}
