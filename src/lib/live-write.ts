import { create } from "zustand";
import { useIde } from "@/store/ide";
import { agentGen, agentAborted } from "./abort";
import { draftFromText, draftFromToolArgs, extractJsonString, mcpMirrorPath } from "./live-write-parse";
export { draftFromText, draftFromToolArgs, extractJsonString, mcpMirrorPath };

type Preview = { path: string; content: string; source: "tool" | "text" | "mcp" };
export const useLivePreview = create<{ draft: Preview | null; streaming: boolean }>(() => ({ draft: null, streaming: false }));
const bases = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: Preview | null = null;
let scope = { epoch: -1, generation: -1 };

export function resetLiveWrite() {
  clearTimeout(timer); timer = undefined;
  bases.clear(); pending = null;
  scope = { epoch: useIde.getState().workspaceEpoch, generation: agentGen() };
  useLivePreview.setState({ draft: null, streaming: false });
}

function enabled() {
  const s = useIde.getState();
  return s.liveEditor && s.workspaceEpoch === scope.epoch && agentGen() === scope.generation && !agentAborted();
}

function publishPreview(next: Preview, streaming: boolean) {
  const previous = useLivePreview.getState().draft;
  useLivePreview.setState({ draft: next, streaming });
  // MCP output is a separate mirror; unfinished files stay outside the workspace.
  if (next.source !== "mcp" && previous?.path !== next.path) {
    const s = useIde.getState();
    if (next.path in s.files) s.openFile(next.path);
    else s.setPanels({ ...s.panels, code: true });
  }
}

function preview(draft: Preview) {
  if (!enabled()) return;
  pending = { ...draft, content: draft.content.slice(0, 1_500_000) };
  timer ??= setTimeout(() => {
    timer = undefined;
    if (enabled() && pending) publishPreview(pending, true);
    pending = null;
  }, 50);
}

/** End the writing preview when the stream ends, not when the whole agent stops. */
export function finishLiveWrite(generation: number) {
  if (generation !== scope.generation || generation !== agentGen()) return;
  clearTimeout(timer); timer = undefined;
  if (enabled() && pending) publishPreview(pending, false);
  pending = null;
  useLivePreview.setState({ streaming: false });
}

export function applyLiveDraft(name: string, argsJson: string) {
  if (!enabled()) return;
  const d = draftFromToolArgs(name, argsJson);
  if (!d?.path) return;
  if (!bases.has(d.path)) bases.set(d.path, useIde.getState().files[d.path] ?? "");
  const before = bases.get(d.path)!;
  let content = d.content;
  if (d.mode === "append") content = before + content;
  if (d.mode === "edit") {
    const old = extractJsonString(argsJson, "old_string");
    if (!old || !before.includes(old) || extractJsonString(argsJson, "new_string") === null) return;
    content = before.replace(old, content);
  } else if (extractJsonString(argsJson, "content") === null) return;
  preview({ path: d.path, content, source: "tool" });
}

export function applyLiveText(text: string) {
  const d = draftFromText(text);
  if (d) preview({ path: d.path, content: d.content, source: "text" });
}

export function applyMcpLive(server: string, tool: string, args: unknown, chunk: string) {
  if (!enabled() || !chunk) return;
  const path = mcpMirrorPath(server, args, tool);
  if (!path) return;
  const prev = pending ?? useLivePreview.getState().draft;
  preview({ path, content: (prev?.path === path ? prev.content : "") + chunk, source: "mcp" });
}

if (typeof window !== "undefined") useIde.subscribe((s, prev) => {
  if (s.workspaceEpoch !== prev.workspaceEpoch || !s.liveEditor || (!s.agentBusy && prev.agentBusy)) resetLiveWrite();
  else {
    if (pending && s.files[pending.path] !== prev.files[pending.path]) {
      bases.delete(pending.path);
      clearTimeout(timer); timer = undefined;
      pending = null;
    }
    const draft = useLivePreview.getState().draft;
    if (draft && s.files[draft.path] !== prev.files[draft.path]) {
      bases.delete(draft.path);
      useLivePreview.setState({ draft: null, streaming: false });
    }
  }
});
