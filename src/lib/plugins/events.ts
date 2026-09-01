export type PluginEvent = "save" | "open" | "run" | "change" | "debug" | "agent";

type Handler = (payload: unknown) => void;
const bus = new Map<PluginEvent, Set<Handler>>();

export function onPlugin(event: PluginEvent, fn: Handler): () => void {
  const set = bus.get(event) ?? new Set<Handler>();
  set.add(fn);
  bus.set(event, set);
  return () => set.delete(fn);
}

export function emitPlugin(event: PluginEvent, payload?: unknown) {
  for (const fn of bus.get(event) ?? []) {
    try {
      fn(payload);
    } catch {
      /* plugin hook */
    }
  }
}

export function clearPluginHooks() {
  bus.clear();
}
