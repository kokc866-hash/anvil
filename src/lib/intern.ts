import { create } from "zustand";
import { persist } from "zustand/middleware";
import { idePersistStorage } from "./persist-storage";
import { fingerprint, internNoise, internPromptFrom, suggestHeal, type HealId, type InternKind } from "./intern-core";

export type { HealId, InternKind };
export { fingerprint, suggestHeal, internPromptFrom };
export type RestartKind = "soft" | "hard" | "factory";

export type InternFault = {
  id: string;
  fp: string;
  kind: InternKind;
  msg: string;
  at: number;
  n: number;
  heal?: HealId;
  healedAt?: number;
  open: boolean;
};

export type InternPrefs = {
  on: boolean;
  autoHeal: boolean;
  autoSoft: boolean;
};

const PREFS: InternPrefs = { on: true, autoHeal: true, autoSoft: false };

let autos = 0;

type InternState = {
  prefs: InternPrefs;
  faults: InternFault[];
  pane: boolean;
  boot: number;
  setPrefs: (p: Partial<InternPrefs>) => void;
  setPane: (v: boolean) => void;
  note: (kind: InternKind, msg: string) => InternFault | null;
  ignore: (id: string) => void;
  clear: () => void;
  heal: (id: string) => Promise<string>;
  healOpen: () => Promise<number>;
  resolveKind: (kind: InternKind) => void;
  restart: (kind: RestartKind) => Promise<void>;
};

function nid() {
  return Math.random().toString(36).slice(2, 9);
}

export const useIntern = create<InternState>()(
  persist(
    (set, get) => ({
      prefs: PREFS,
      faults: [],
      pane: false,
      boot: 0,
      setPrefs: (p) => set({ prefs: { ...get().prefs, ...p } }),
      setPane: (pane) => set({ pane }),
      note: (kind, msg) => {
        const text = String(msg ?? "").slice(0, 280);
        if (!get().prefs.on || !text || internNoise(text)) return null;
        const fp = fingerprint(kind, text);
        const now = Date.now();
        const cur = get().faults.find((f) => f.fp === fp && now - f.at < 86_400_000);
        let fault: InternFault;
        if (cur) {
          fault = { ...cur, msg: text, at: now, n: cur.n + 1, open: true };
          set({ faults: [fault, ...get().faults.filter((f) => f.id !== cur.id)].slice(0, 40) });
        } else {
          const sug = suggestHeal(fp, kind);
          fault = { id: nid(), fp, kind, msg: text, at: now, n: 1, heal: sug.heal, open: true };
          set({ faults: [fault, ...get().faults].slice(0, 40) });
        }
        void import("./app-log").then((m) => m.appLog("intern", `${kind} ${text}`));
        const sug = suggestHeal(fault.fp, fault.kind);
        if (get().prefs.autoHeal && sug.auto && sug.heal !== "none" && autos < 3) {
          autos += 1;
          void get().heal(fault.id);
        } else if (kind === "persist" && get().prefs.autoSoft && autos < 3) {
          autos += 1;
          void get().restart("soft");
        }
        return fault;
      },
      ignore: (id) =>
        set({
          faults: get().faults.map((f) => (f.id === id ? { ...f, open: false } : f)),
        }),
      clear: () => set({ faults: [] }),
      heal: async (id) => {
        const f = get().faults.find((x) => x.id === id);
        if (!f) return "nicht gefunden";
        const sug = suggestHeal(f.fp, f.kind);
        const heal = f.heal && f.heal !== "none" ? f.heal : sug.heal;
        const out = await runHeal(heal, f);
        set({
          faults: get().faults.map((x) =>
            x.id === id ? { ...x, open: false, healedAt: Date.now(), heal } : x,
          ),
        });
        return out;
      },
      healOpen: async () => {
        const open = get().faults.filter((f) => f.open && f.heal && f.heal !== "none" && f.heal !== "agent-task");
        for (const f of open) await get().heal(f.id);
        return open.length;
      },
      resolveKind: (kind) => {
        const faults = get().faults.filter((f) => f.kind !== kind);
        if (faults.length === get().faults.length) return;
        set({ faults });
      },
      restart: async (kind) => {
        const { stopAgent } = await import("./abort");
        const { recoverSession } = await import("./health");
        stopAgent("Neustart");
        recoverSession();
        if (kind === "soft") {
          set({ boot: get().boot + 1, pane: false });
          return;
        }
        if (kind === "hard") {
          location.reload();
          return;
        }
        await factoryWipe();
        location.reload();
      },
    }),
    {
      name: "anvil-intern",
      storage: idePersistStorage(),
      partialize: (s) => ({ prefs: s.prefs, faults: s.faults.slice(0, 24) }),
    },
  ),
);

export function note(kind: InternKind, msg: string): InternFault | null {
  try {
    return useIntern.getState().note(kind, msg);
  } catch {
    return null;
  }
}

export function resolveKind(kind: InternKind): void {
  try {
    useIntern.getState().resolveKind(kind);
  } catch {
    /* */
  }
}

export function internPrompt(): string {
  try {
    return internPromptFrom(useIntern.getState().faults);
  } catch {
    return "";
  }
}

export function internOpen(): number {
  return useIntern.getState().faults.filter((f) => f.open).length;
}

export function startIntern(): void {
  if (typeof window === "undefined") return;
  const w = window as Window & { __anvilIntern?: boolean };
  if (w.__anvilIntern) return;
  w.__anvilIntern = true;
  void import("./app-log").then((m) => m.bootAppLog());
  window.addEventListener("error", (e) => {
    const msg = e.message || e.error?.message || "error";
    note("js", String(msg));
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    note("js", r instanceof Error ? r.message : String(r));
  });
  void import("./health").then((h) => h.startHealth());
}

async function runHeal(heal: HealId, fault?: InternFault): Promise<string> {
  if (heal === "none") return "kein automatischer Fix — an den Agenten geben oder ignorieren";
  if (heal === "agent-abort") {
    const { stopAgent } = await import("./abort");
    stopAgent("Vom Intern gestoppt");
    const { useIde } = await import("@/store/ide");
    useIde.getState().setNotice("Agent abgebrochen");
    return "Agent gestoppt";
  }
  if (heal === "soft-restart") {
    useIntern.getState().restart("soft");
    return "Weicher Neustart";
  }
  if (heal === "hard-reload") {
    location.reload();
    return "Neuladen";
  }
  if (heal === "board-reset") {
    const { useIde } = await import("@/store/ide");
    const { defaultBoard, filesFromBoard } = await import("./harness-board");
    const st = useIde.getState();
    const s = {
      runLoop: st.runLoop,
      graphLoop: st.graphLoop,
      afterWrite: st.harnessAfterWrite ?? "run",
      loopTries: st.loopTries ?? 3,
      maxRounds: st.harnessMaxRounds ?? 12,
    };
    const pack = filesFromBoard(defaultBoard(s), s);
    for (const [p, c] of Object.entries(pack)) st.writeFile(p, c);
    st.setNotice("Tafel auf Standard");
    return "Tafel zurückgesetzt";
  }
  if (heal === "preview-reload") {
    const { useIde } = await import("@/store/ide");
    const st = useIde.getState();
    st.setPreviewOpen(false);
    window.setTimeout(() => {
      useIde.getState().setPreviewOpen(true);
      useIde.getState().setNotice("Vorschau neu geladen");
    }, 40);
    return "Vorschau neu geladen";
  }
  if (heal === "agent-task") {
    const { useIde } = await import("@/store/ide");
    const msg = `Fix this intern error:\n${fault?.kind ?? "js"}: ${fault?.msg ?? ""}\nFind the cause and patch it in the workspace.`;
    useIde.getState().pushAgent(msg);
    useIde.getState().setNotice("Auftrag an den Agenten");
    return "An den Agenten gegeben";
  }
  return "ok";
}

async function factoryWipe() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /^(anvil|grok-auth)/i.test(k)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
  try {
    if (typeof sessionStorage !== "undefined") {
      const keys: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && /^(anvil|grok-auth)/i.test(k)) keys.push(k);
      }
      for (const k of keys) sessionStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
  for (const name of ["anvil-persist", "anvil-disk"]) {
    try {
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    } catch {
      /* ignore */
    }
  }
}

export const HEAL_LABEL: Record<HealId, string> = {
  "board-reset": "Tafel-Standard",
  "agent-abort": "Agent stoppen",
  "soft-restart": "Oberfläche neu",
  "hard-reload": "Seite neu",
  "preview-reload": "Vorschau neu",
  "agent-task": "An Agent",
  none: "—",
};
