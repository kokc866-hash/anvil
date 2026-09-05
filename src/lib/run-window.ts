import { useIde } from "@/store/ide";
import { nativeHelper } from "./helper-local";

let win: Window | null = null;
let timer = 0;
let agentHeld = false;
let agentPreview = false;
let park = 0;
let gen = 0;
let chain: Promise<unknown> = Promise.resolve();
const SIZE_KEY = "anvil-run-size";

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function savedSize(): { w: number; h: number } {
  try {
    const s = JSON.parse(localStorage.getItem(SIZE_KEY) ?? "") as { w?: number; h?: number };
    return {
      w: clamp(Number(s.w) || 960, 480, Math.max(480, window.screen.availWidth || 1600)),
      h: clamp(Number(s.h) || 640, 360, Math.max(360, window.screen.availHeight || 900)),
    };
  } catch {
    return { w: 960, h: 640 };
  }
}

function rememberSize() {
  if (!win || win.closed) return;
  try {
    const w = win.outerWidth || win.innerWidth;
    const h = win.outerHeight || win.innerHeight;
    if (w > 200 && h > 160) localStorage.setItem(SIZE_KEY, JSON.stringify({ w, h }));
  } catch {
    /* ignore */
  }
}

function native() {
  return nativeHelper() as
    | (ReturnType<typeof nativeHelper> & {
        openChild?: (path: string, opts?: { w?: number; h?: number; title?: string }) => Promise<number>;
        focusChild?: (path: string) => Promise<boolean>;
        closeChild?: (path: string) => Promise<boolean>;
        childAlive?: (path: string) => Promise<boolean>;
      })
    | null;
}

function enqueue(fn: () => Promise<void>) {
  chain = chain.then(fn, fn);
  return chain;
}

function watchClosed(n: NonNullable<ReturnType<typeof native>>) {
  if (timer) window.clearInterval(timer);
  timer = window.setInterval(() => {
    void n.childAlive?.("/run").then((alive) => {
      if (alive) return;
      useIde.setState({ runPopout: false });
      window.clearInterval(timer);
      timer = 0;
      if (!useIde.getState().companionKeep) {
        void import("./companion-life").then((c) => c.releaseCompanion());
      }
    });
  }, 800);
}

function watchPopup() {
  if (timer) window.clearInterval(timer);
  timer = window.setInterval(() => {
    if (!win || win.closed) {
      rememberSize();
      useIde.setState({ runPopout: false });
      window.clearInterval(timer);
      timer = 0;
      win = null;
      if (!useIde.getState().companionKeep) {
        void import("./companion-life").then((c) => c.releaseCompanion());
      }
      return;
    }
    rememberSize();
  }, 800);
}

export function openRunWindow(opts?: { agent?: boolean }) {
  if (opts?.agent || useIde.getState().agentBusy) agentHeld = true;
  else agentHeld = false;
  const g = ++gen;
  const { w, h } = savedSize();
  void enqueue(async () => {
    if (g !== gen) return;
    const n = native();
    if (n?.openChild) {
      if (await n.childAlive?.("/run")) await n.focusChild?.("/run");
      else await n.openChild?.("/run", { w, h, title: "Run" });
      if (g !== gen) {
        await n.closeChild?.("/run");
        return;
      }
      useIde.setState({ runPopout: true, previewOpen: false });
      watchClosed(n);
      return;
    }
    if (win && !win.closed) {
      if (g !== gen) return;
      win.focus();
      useIde.setState({ runPopout: true, previewOpen: false });
      return;
    }
    win = window.open("/run", "anvil-run", `popup=yes,width=${w},height=${h}`);
    if (g !== gen) {
      try {
        win?.close();
      } catch {
        /* */
      }
      win = null;
      return;
    }
    if (!win) {
      if (opts?.agent) agentPreview = true;
      useIde.getState().setPreviewOpen(true);
      useIde.getState().setNotice("Popup blockiert — Vorschau im Editor");
      return;
    }
    useIde.setState({ runPopout: true, previewOpen: false });
    win.focus();
    watchPopup();
  });
}

export function focusRunWindow() {
  const n = native();
  if (n?.focusChild) {
    void n.focusChild("/run").then((ok) => {
      if (!ok) openRunWindow();
    });
    return;
  }
  if (win && !win.closed) win.focus();
  else openRunWindow();
}

export function closeRunWindow() {
  gen += 1;
  rememberSize();
  if (timer) {
    window.clearInterval(timer);
    timer = 0;
  }
  const n = native();
  void enqueue(async () => {
    if (n?.closeChild) {
      try {
        await n.closeChild("/run");
      } catch {
        /* */
      }
    }
    if (win && !win.closed) {
      try {
        win.close();
      } catch {
        /* */
      }
    }
    win = null;
    useIde.setState({ runPopout: false });
    if (!useIde.getState().companionKeep) {
      void import("./companion-life").then((c) => c.releaseCompanion());
    }
  });
}

export function dockRunWindow() {
  closeRunWindow();
  useIde.getState().setPreviewOpen(true);
}

export function agentOpenedPreview() {
  agentPreview = true;
}

export function pickRunPreview(
  files: Record<string, string>,
  runPath: string | null | undefined,
  activePath: string | null | undefined,
  popout = false,
): string {
  if (runPath && runPath in files) return runPath;
  if (popout) {
    if (activePath && activePath in files && /\.html?$/i.test(activePath)) return activePath;
    return Object.keys(files).find((p) => /\.html?$/i.test(p) && !p.startsWith(".anvil/")) || activePath || "";
  }
  return activePath && activePath in files ? activePath : activePath || "";
}

export function fileForRun(): string {
  const s = useIde.getState();
  return pickRunPreview(s.files, s.runPath, s.activePath, true);
}

export function rememberRunFile(path: string) {
  if (path) useIde.getState().setRunPath(path);
}

export function keepAgentRun() {
  if (park) {
    window.clearTimeout(park);
    park = 0;
  }
}

export function parkAgentRun() {
  if (!agentHeld && !agentPreview) return;
  if (park) window.clearTimeout(park);
  park = window.setTimeout(() => {
    park = 0;
    dropAgentRun();
  }, 400);
}

const KEEP_RUN = /^(run_file|see_run|play|open_preview|engine_run)$/;

export function agentToolUi(name: string, path?: string) {
  if (path && KEEP_RUN.test(name)) rememberRunFile(path);
  if (KEEP_RUN.test(name)) keepAgentRun();
  else parkAgentRun();
}

function dropAgentRun() {
  keepAgentRun();
  const preview = agentPreview;
  const held = agentHeld;
  agentPreview = false;
  agentHeld = false;
  if (held) closeRunWindow();
  if (preview) {
    const st = useIde.getState();
    if (st.previewOpen && !st.runPopout) st.setPreviewOpen(false);
  }
  useIde.getState().setRunPath(null);
}

export function releaseAgentUi() {
  dropAgentRun();
}
