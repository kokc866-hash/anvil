import { create } from "zustand";
import { persist } from "zustand/middleware";
import { idePersistStorage } from "./persist-storage";
import { HELPER_SMALL } from "./brain/models";

function openaiRoot(baseUrl: string): string {
  let u = (baseUrl || "http://127.0.0.1:11434/v1").trim().replace(/\/+$/, "");
  if (!/\/v1$/i.test(u) && !/\/v1\//i.test(u)) u += "/v1";
  return u.replace(/\/v1$/i, "");
}

export type CacheBackendPref = "auto" | "opfs" | "indexeddb";

export type LocalAgentModel = {
  name: string;
  size: number;
  modified?: string;
};

export type PullProgress = { status: string; done: number; total: number };

type ModelLibState = {
  cacheBackend: CacheBackendPref;
  keepHelperCache: boolean;
  prefetchOnStart: boolean;
  pinHelper: string[];
  pinAgent: string[];
  lastAgent: LocalAgentModel[];
  lastQuota: { used: number; quota: number };
  setCacheBackend: (v: CacheBackendPref) => void;
  setKeepHelperCache: (v: boolean) => void;
  setPrefetchOnStart: (v: boolean) => void;
  togglePinHelper: (id: string) => void;
  togglePinAgent: (name: string) => void;
  setLastAgent: (rows: LocalAgentModel[]) => void;
  setLastQuota: (v: { used: number; quota: number }) => void;
};

export const useModelLib = create<ModelLibState>()(
  persist(
    (set, get) => ({
      cacheBackend: "auto",
      keepHelperCache: true,
      prefetchOnStart: false,
      pinHelper: [...HELPER_SMALL],
      pinAgent: [],
      lastAgent: [],
      lastQuota: { used: 0, quota: 0 },
      setCacheBackend: (cacheBackend) => set({ cacheBackend }),
      setKeepHelperCache: (keepHelperCache) => set({ keepHelperCache }),
      setPrefetchOnStart: (prefetchOnStart) => set({ prefetchOnStart }),
      togglePinHelper: (id) => {
        const cur = get().pinHelper;
        set({ pinHelper: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(0, 8) });
      },
      togglePinAgent: (name) => {
        const cur = get().pinAgent;
        set({ pinAgent: cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name].slice(0, 12) });
      },
      setLastAgent: (lastAgent) => set({ lastAgent }),
      setLastQuota: (lastQuota) => set({ lastQuota }),
    }),
    {
      name: "anvil-models",
      skipHydration: true,
      storage: idePersistStorage(),
      partialize: (s) => ({
        cacheBackend: s.cacheBackend,
        keepHelperCache: s.keepHelperCache,
        prefetchOnStart: s.prefetchOnStart,
        pinHelper: s.pinHelper,
        pinAgent: s.pinAgent,
        lastAgent: s.lastAgent,
        lastQuota: s.lastQuota,
      }),
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<ModelLibState>;
        const pin = (p.pinHelper ?? current.pinHelper ?? []).filter((id) => !/[-.]4B-q4f/i.test(id));
        return {
          ...current,
          ...p,
          pinHelper: pin.length ? pin : [...HELPER_SMALL],
        };
      },
    },
  ),
);

export function cacheOrder(): Array<"opfs" | "indexeddb"> {
  const v = useModelLib.getState().cacheBackend;
  if (v === "indexeddb") return ["indexeddb", "opfs"];
  if (v === "opfs") return ["opfs", "indexeddb"];
  return ["opfs", "indexeddb"];
}

export async function storageQuota(): Promise<{ used: number; quota: number }> {
  try {
    const est = await navigator.storage?.estimate?.();
    const used = est?.usage ?? 0;
    const quota = est?.quota ?? 0;
    useModelLib.getState().setLastQuota({ used, quota });
    return { used, quota };
  } catch {
    return { used: 0, quota: 0 };
  }
}

export function ollamaRoot(baseUrl: string): string {
  return openaiRoot(baseUrl);
}

export async function listLocalAgentModels(baseUrl: string): Promise<LocalAgentModel[]> {
  const root = ollamaRoot(baseUrl);
  const res = await fetch(`${root}/api/tags`);
  if (!res.ok) {
    const open = await fetch(`${openaiRoot(baseUrl)}/v1/models`);
    if (!open.ok) throw new Error(`Modelle: HTTP ${res.status}`);
    const json = (await open.json()) as { data?: { id: string }[] };
    const rows = (json.data ?? []).map((m) => ({ name: m.id, size: 0 }));
    useModelLib.getState().setLastAgent(rows);
    return rows;
  }
  const json = (await res.json()) as { models?: { name: string; size?: number; modified_at?: string }[] };
  const rows = (json.models ?? []).map((m) => ({
    name: m.name,
    size: m.size ?? 0,
    modified: m.modified_at,
  }));
  useModelLib.getState().setLastAgent(rows);
  return rows;
}

export async function pullLocalAgentModel(
  baseUrl: string,
  name: string,
  onProgress?: (p: PullProgress) => void,
): Promise<void> {
  const root = ollamaRoot(baseUrl);
  const res = await fetch(`${root}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim(), stream: true }),
  });
  if (!res.ok) throw new Error(`Pull: HTTP ${res.status}`);
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        const j = JSON.parse(t) as { status?: string; completed?: number; total?: number; error?: string };
        if (j.error) throw new Error(j.error);
        onProgress?.({ status: j.status ?? "pull", done: j.completed ?? 0, total: j.total ?? 0 });
      } catch (err) {
        if (err instanceof SyntaxError) continue;
        throw err;
      }
    }
  }
}

export async function deleteLocalAgentModel(baseUrl: string, name: string): Promise<void> {
  const root = ollamaRoot(baseUrl);
  const res = await fetch(`${root}/api/delete`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok && res.status !== 404) throw new Error(`Löschen: HTTP ${res.status}`);
}

export function fmtBytes(n: number): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
