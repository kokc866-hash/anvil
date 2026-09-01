import { useIde } from "@/store/ide";
import { nativeHelper } from "./helper-local";

let win: Window | null = null;
let timer = 0;

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

export function openOutputWindow() {
  const n = native();
  if (n?.openChild) {
    void (async () => {
      if (await n.childAlive?.("/console")) await n.focusChild?.("/console");
      else await n.openChild?.("/console", { w: 780, h: 520, title: "Ausgabe" });
    })();
    useIde.setState({
      outputPopout: true,
      panels: { ...useIde.getState().panels, output: true },
    });
    if (timer) window.clearInterval(timer);
    timer = window.setInterval(() => {
      void n.childAlive?.("/console").then((alive) => {
        if (!alive) {
          useIde.setState({ outputPopout: false });
          window.clearInterval(timer);
          timer = 0;
        }
      });
    }, 400);
    return;
  }
  win = window.open("/console", "anvil-console", "popup=yes,width=780,height=520");
  if (!win) {
    useIde.getState().setOutputDock("side");
    return;
  }
  useIde.setState({
    outputPopout: true,
    panels: { ...useIde.getState().panels, output: true },
  });
  win.focus();
  if (timer) window.clearInterval(timer);
  timer = window.setInterval(() => {
    if (!win || win.closed) {
      useIde.setState({ outputPopout: false });
      window.clearInterval(timer);
      timer = 0;
      win = null;
    }
  }, 400);
}

export function focusOutputWindow() {
  const n = native();
  if (n?.focusChild) {
    void n.focusChild("/console").then((ok) => {
      if (!ok) openOutputWindow();
    });
    return;
  }
  if (win && !win.closed) win.focus();
  else openOutputWindow();
}

export function closeOutputWindow() {
  const n = native();
  if (n?.closeChild) void n.closeChild("/console");
  if (win && !win.closed) win.close();
  win = null;
  if (timer) window.clearInterval(timer);
  timer = 0;
  useIde.setState({ outputPopout: false });
}