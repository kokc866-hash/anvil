import { isSecretPath, omitSecrets } from "@/lib/ref";
import { useIde } from "@/store/ide";

const CHANNEL = "anvil-output";

function popout(): boolean {
  const p = window.location.pathname;
  return p.startsWith("/run") || p.startsWith("/console");
}

function keepSecrets(incoming: Record<string, string>, cur: Record<string, string>): Record<string, string> {
  const out = { ...incoming };
  for (const [p, c] of Object.entries(cur)) {
    if (isSecretPath(p)) out[p] = c;
  }
  return out;
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
      files: omitSecrets(s.files),
      activePath: s.activePath,
      runPath: s.runPath,
      theme: s.theme,
      inputMap: s.inputMap,
      runHtml: s.runHtml,
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
      s.runPath === prev.runPath &&
      s.theme === prev.theme &&
      s.inputMap === prev.inputMap &&
      s.runHtml === prev.runHtml
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
      runPath?: string | null;
      theme?: ReturnType<typeof useIde.getState>["theme"];
      inputMap?: ReturnType<typeof useIde.getState>["inputMap"];
      runHtml?: boolean;
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
      files: d.files ? keepSecrets(d.files, cur.files) : cur.files,
      activePath: typeof d.activePath === "string" ? d.activePath : cur.activePath,
      runPath: typeof d.runPath === "string" ? d.runPath : d.runPath === null ? null : cur.runPath,
      theme: d.theme ?? cur.theme,
      inputMap: d.inputMap ?? cur.inputMap,
      runHtml: typeof d.runHtml === "boolean" ? d.runHtml : cur.runHtml,
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