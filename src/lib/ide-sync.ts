import { useIde } from "@/store/ide";

const CHANNEL = "anvil-output";

function popout(): boolean {
  const p = window.location.pathname;
  return p.startsWith("/run") || p.startsWith("/console");
}

export function startIdeSync() {
  const ch = new BroadcastChannel(CHANNEL);
  let echo = false;
  let timer = 0;
  const child = popout();

  function snapshot() {
    const s = useIde.getState();
    return {
      output: s.output,
      running: s.running,
      files: s.files,
      activePath: s.activePath,
      theme: s.theme,
      inputMap: s.inputMap,
    };
  }

  function send(wait: number) {
    if (child) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (echo) return;
      ch.postMessage(snapshot());
    }, wait);
  }

  const unsub = useIde.subscribe((s, prev) => {
    if (echo || child) return;
    if (
      s.output === prev.output &&
      s.running === prev.running &&
      s.files === prev.files &&
      s.activePath === prev.activePath &&
      s.theme === prev.theme &&
      s.inputMap === prev.inputMap
    ) {
      return;
    }
    const filesOnly = s.files !== prev.files && s.output === prev.output && s.running === prev.running;
    send(filesOnly ? 420 : 40);
  });

  ch.onmessage = (ev) => {
    const d = ev.data as {
      want?: number;
      output?: ReturnType<typeof useIde.getState>["output"];
      running?: boolean;
      files?: Record<string, string>;
      activePath?: string;
      theme?: ReturnType<typeof useIde.getState>["theme"];
      inputMap?: ReturnType<typeof useIde.getState>["inputMap"];
    } | null;
    if (!d || typeof d !== "object") return;
    if (d.want === 1) {
      if (!child) send(0);
      return;
    }
    if (!child) return;
    echo = true;
    const cur = useIde.getState();
    useIde.setState({
      output: d.output ?? cur.output,
      running: typeof d.running === "boolean" ? d.running : cur.running,
      files: d.files ?? cur.files,
      activePath: typeof d.activePath === "string" ? d.activePath : cur.activePath,
      theme: d.theme ?? cur.theme,
      inputMap: d.inputMap ?? cur.inputMap,
    });
    echo = false;
  };

  if (child) ch.postMessage({ want: 1 });
  else send(0);

  return () => {
    unsub();
    window.clearTimeout(timer);
    ch.close();
  };
}