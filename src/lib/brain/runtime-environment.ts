export const LOCAL_MODEL_ORIGIN = "https://anvil-helper.invalid";
export type RuntimeEnvironment = {
  power: "high-performance" | "low-power";
  routes: { from: string; to: string }[];
};

/** Cache keys never contain localhost ports or credentials. Only our private
 * model URLs are routed to the authenticated host, during this runtime's load. */
export function installRuntimeEnvironment(env: RuntimeEnvironment): () => void {
  const originalFetch = globalThis.fetch;
  const routedFetch: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const route = env.routes.find((r) => url.startsWith(r.from));
    if (!route) return originalFetch(input, init);
    const target = route.to + url.slice(route.from.length);
    return originalFetch(input instanceof Request ? new Request(target, input) : target, init);
  };
  globalThis.fetch = routedFetch;
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: (opts?: Record<string, unknown>) => Promise<unknown> } }).gpu;
  const originalAdapter = gpu?.requestAdapter;
  const adapter = (opts?: Record<string, unknown>) => originalAdapter!.call(gpu, { ...opts, powerPreference: env.power });
  if (gpu && originalAdapter) gpu.requestAdapter = adapter;
  return () => {
    if (globalThis.fetch === routedFetch) globalThis.fetch = originalFetch;
    if (gpu && gpu.requestAdapter === adapter && originalAdapter) gpu.requestAdapter = originalAdapter;
  };
}
