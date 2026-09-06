import { useIde } from "@/store/ide";
import { ANVIL_SURFACE, surfaceLabel, surfacePrompt, type SurfaceSnap } from "./surface";
import { mcpProbe, mcpRefresh, mcpSnapshot, mcpListError } from "./mcp";
import { agentGen, raceAbort, throwIfAborted } from "./abort";
import { requestPhase } from "./request-state";

export async function surfaceNote(): Promise<{ text: string; id: string; mode: SurfaceSnap["mode"] }> {
  const st = useIde.getState();
  const id = st.activeSurfaceId || ANVIL_SURFACE;
  const mode = st.surfaceMode === "bridge" ? "bridge" : "exclusive";
  const servers = st.mcpServers ?? [];
  const selected = servers.find((s) => s.id === id);
  let snapshot = mcpSnapshot(servers);
  if (id !== ANVIL_SURFACE && selected?.enabled && !snapshot.ready.has(selected.id)) {
    requestPhase(agentGen(), "catalog", selected.name || selected.id);
    await raceAbort(mcpProbe(selected, servers));
    throwIfAborted();
    snapshot = mcpSnapshot(servers);
  } else if (servers.some((s) => s.enabled && s.url.trim())) {
    // Refresh alongside the model request. A stale server does not block ordinary chat.
    void mcpRefresh(servers).catch(() => undefined);
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
    servers: servers.filter((s) => s.enabled && s.url.trim()).map((s) => ({ id: s.id, name: s.name, ready: snapshot.ready.has(s.id), error: mcpListError(s.id) })),
  };
  return { text: surfacePrompt(snap), id, mode };
}
