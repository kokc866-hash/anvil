import { isSecretPath, omitSecrets } from "@/lib/ref";
import { useIde } from "@/store/ide";

const CHANNEL = "anvil-output";
/** Same Electron partition; initial snapshot followed by versioned file deltas. */
export function startIdeSync() {
  const ch = new BroadcastChannel(CHANNEL), id = crypto.randomUUID();
  const child = /^\/(run|console)(\/|$)/.test(window.location.pathname);
  const peers = new Map<string, number>();
  let timer = 0, owner = "", revision = 0, received = 0;
  let previous = useIde.getState();
  const meta = (s: typeof previous) => ({ output: s.output, running: s.running, activePath: s.activePath, runPath: s.runPath,
    theme: s.theme, inputMap: s.inputMap, runHtml: s.runHtml, workspaceCwd: s.workspaceCwd, diskName: s.diskName, githubRepo: s.githubRepo, workspaceEpoch: s.workspaceEpoch });
  function send(full = false) {
    if (child) return;
    for (const [peer, at] of peers) if (Date.now() - at > 45000) peers.delete(peer);
    if (!peers.size) return;
    const s = useIde.getState();
    full ||= s.workspaceEpoch !== previous.workspaceEpoch;
    const delta: Record<string, string | null> = {};
    if (!full && s.files !== previous.files) {
      for (const [p, content] of Object.entries(s.files)) if (!isSecretPath(p) && previous.files[p] !== content) delta[p] = content;
      for (const p of Object.keys(previous.files)) if (!isSecretPath(p) && !(p in s.files)) delta[p] = null;
    }
    ch.postMessage({ owner: id, version: 2, revision: ++revision, full, ...meta(s), ...(full ? { files: omitSecrets(s.files) } : { delta }) });
    previous = s;
  }
  const unsub = useIde.subscribe((s, prev) => {
    if (child || !peers.size) return;
    if (s.files === prev.files && Object.keys(meta(s)).every((key) => s[key as keyof typeof s] === prev[key as keyof typeof prev])) return;
    clearTimeout(timer);
    timer = window.setTimeout(() => send(), s.files !== prev.files && s.output === prev.output ? 420 : 40);
  });
  const request = () => ch.postMessage({ want: 1, peer: id, owner: owner || undefined, version: 2 });
  ch.onmessage = ({ data: d }) => {
    if (!d || typeof d !== "object") return;
    if (d.want === 1 && !child && typeof d.peer === "string" && (!d.owner || d.owner === id)) {
      const known = peers.has(d.peer); peers.set(d.peer, Date.now());
      if (!known || d.resync) send(true);
      return;
    }
    if (!child) { if (d.bye) peers.delete(d.bye); return; }
    if (typeof d.owner !== "string" || (owner && owner !== d.owner)) return;
    if (!d.full && (!owner || d.revision !== received + 1)) { ch.postMessage({ want: 1, peer: id, owner: owner || d.owner, resync: true }); return; }
    if (d.revision <= received && owner === d.owner) return;
    owner = d.owner; received = d.revision;
    const cur = useIde.getState();
    let files = cur.files;
    if (d.full && d.files && typeof d.files === "object") {
      files = Object.fromEntries(Object.entries(d.files).filter(([p, value]) => !isSecretPath(p) && typeof value === "string")) as Record<string, string>;
      // Credentials are never transferred between windows or retained across projects.
      if (cur.workspaceCwd === d.workspaceCwd) for (const [p, c] of Object.entries(cur.files)) if (isSecretPath(p)) files[p] = c;
    } else if (d.delta && typeof d.delta === "object" && Object.keys(d.delta).length) {
      files = { ...cur.files };
      for (const [p, c] of Object.entries(d.delta)) { if (isSecretPath(p)) continue; if (c === null) delete files[p]; else if (typeof c === "string") files[p] = c; }
    }
    const changes: Partial<typeof cur> = { files };
    for (const key of Object.keys(meta(cur))) {
      const value = d[key];
      if (value === undefined) continue;
      const old = cur[key as keyof typeof cur];
      if (typeof value === typeof old || ((key === "activePath" || key === "runPath") && (value === null || typeof value === "string"))) Object.assign(changes, { [key]: value });
    }
    useIde.setState(changes);
  };
  if (child) request();
  const heartbeat = child ? setInterval(request, 15000) : undefined;
  return () => { unsub(); clearTimeout(timer); clearInterval(heartbeat); if (child) ch.postMessage({ bye: id }); ch.close(); };
}
