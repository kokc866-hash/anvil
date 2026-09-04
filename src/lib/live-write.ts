import { useIde } from "@/store/ide";
import { draftFromText, draftFromToolArgs, extractJsonString, mcpMirrorPath } from "./live-write-parse";

export { draftFromText, draftFromToolArgs, extractJsonString, mcpMirrorPath };

const appendBase = new Map<string, string>();
let timer = 0;
let pending: { path: string; content: string } | null = null;

export function resetLiveWrite() {
  appendBase.clear();
  pending = null;
  if (timer) {
    clearTimeout(timer);
    timer = 0;
  }
}

function flush() {
  timer = 0;
  const p = pending;
  pending = null;
  if (!p) return;
  useIde.getState().writeFile(p.path, p.content, { quiet: true });
}

export function applyLiveDraft(name: string, argsJson: string) {
  const st = useIde.getState();
  if (!st.liveEditor) return;
  const d = draftFromToolArgs(name, argsJson);
  if (!d?.path) return;
  let body = d.content;
  if (d.mode === "append") {
    if (!appendBase.has(d.path)) appendBase.set(d.path, st.files[d.path] ?? "");
    body = (appendBase.get(d.path) ?? "") + d.content;
  } else if (d.mode === "edit") {
    if (!d.content) {
      if (st.activePath !== d.path) st.openFile(d.path);
      return;
    }
    const old = extractJsonString(argsJson, "old_string");
    const prev = st.files[d.path] ?? "";
    if (old && prev.includes(old)) body = prev.replace(old, d.content);
  }
  pending = { path: d.path, content: body };
  if (!timer) timer = window.setTimeout(flush, 50) as unknown as number;
}

export function applyLiveText(text: string) {
  const d = draftFromText(text);
  if (!d) return;
  applyLiveDraft(d.mode === "append" ? "append_file" : d.mode === "edit" ? "edit_file" : "write_file", JSON.stringify({ path: d.path, content: d.content }));
}

export function applyMcpLive(server: string, tool: string, args: unknown, chunk: string) {
  const st = useIde.getState();
  if (!st.liveEditor || !chunk) return;
  const path = mcpMirrorPath(server, args, tool);
  if (!path) return;
  const prev = pending?.path === path ? pending.content : (st.files[path] ?? "");
  pending = { path, content: prev + chunk };
  if (!timer) timer = window.setTimeout(flush, 50) as unknown as number;
}
