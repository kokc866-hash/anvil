import { useIde } from "@/store/ide";
import { hasMcpNative, mcpAuthStatus, mcpRefresh, type McpServer } from "./mcp";
import { isMcpService, serviceConnectionKey } from "./mcp-service-policy";

const REFRESH_MS = 5 * 60_000;
const RETRY_MS = 30_000;

/** One workspace owner; no consent flow, tool invocation or permission changes. */
export function startServiceAutoconnect() {
  const attempts = new Map<string, number>();
  const jobs = new Map<string, { key: string; controller: AbortController }>();
  let stopped = false;
  const eligible = (s: McpServer) => s.enabled && isMcpService(s) && s.auth === "oauth";
  const current = (s: McpServer) => useIde.getState().mcpServers.find(
    (next) => next.id === s.id && eligible(next) && serviceConnectionKey(next) === serviceConnectionKey(s),
  );

  function tick(retry = false) {
    if (stopped || !hasMcpNative() || !useIde.persist.hasHydrated()) return;
    const servers = useIde.getState().mcpServers;
    for (const [id, job] of jobs) {
      if (!servers.some((s) => s.id === id && eligible(s) && serviceConnectionKey(s) === job.key)) {
        job.controller.abort();
        jobs.delete(id);
      }
    }
    for (const key of attempts.keys()) {
      if (!servers.some((s) => eligible(s) && serviceConnectionKey(s) === key)) attempts.delete(key);
    }
    for (const server of servers) {
      if (!eligible(server) || jobs.has(server.id)) continue;
      const key = serviceConnectionKey(server);
      if (Date.now() - (attempts.get(key) ?? -Infinity) < (retry ? RETRY_MS : REFRESH_MS)) continue;
      if (jobs.size >= 4) break;
      const job = { key, controller: new AbortController() };
      jobs.set(server.id, job);
      attempts.set(key, Date.now());
      const signal = AbortSignal.any([job.controller.signal, AbortSignal.timeout(30_000)]);
      void (async () => {
        // Native status reads the encrypted local vault, not the remote service.
        const auth = await mcpAuthStatus(server, signal);
        signal.throwIfAborted();
        const live = current(server);
        if (auth.authenticated && live) await mcpRefresh([live], retry ? 0 : REFRESH_MS, signal);
      })().catch(() => {
        // Catalog errors are already visible on the service card. Retry later;
        // the normal workspace remains usable while a service is unavailable.
      }).finally(() => {
        if (jobs.get(server.id) === job) jobs.delete(server.id);
        tick();
      });
    }
  }

  const unsubscribe = useIde.subscribe((state, previous) => {
    if (state.mcpServers !== previous.mcpServers) tick();
  });
  const hydrated = useIde.persist.onFinishHydration(() => tick());
  const retry = () => tick(true);
  const visible = () => { if (document.visibilityState === "visible") retry(); };
  const timer = window.setInterval(() => tick(), 60_000);
  window.addEventListener("online", retry);
  window.addEventListener("focus", retry);
  document.addEventListener("visibilitychange", visible);
  tick();
  return () => {
    stopped = true;
    unsubscribe();
    hydrated();
    window.clearInterval(timer);
    window.removeEventListener("online", retry);
    window.removeEventListener("focus", retry);
    document.removeEventListener("visibilitychange", visible);
    for (const job of jobs.values()) job.controller.abort();
    jobs.clear();
  };
}
