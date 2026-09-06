import { create } from "zustand";
import { useIde } from "@/store/ide";
import { agentGen, agentAborted } from "./abort";
import { draftFromText, draftFromToolArgs, extractJsonString, mcpMirrorPath } from "./live-write-parse";
export { draftFromText, draftFromToolArgs, extractJsonString, mcpMirrorPath };

type Preview = { path: string; content: string; source: "tool" | "text" | "mcp" };
export const useLivePreview = create<{ draft: Preview | null }>(() => ({ draft: null }));
const bases = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: Preview | null = null;
let scope = { epoch: -1, generation: -1 };

export function resetLiveWrite() {
  clearTimeout(timer); timer = undefined;
  bases.clear(); pending = null;
  scope = { epoch: useIde.getState().workspaceEpoch, generation: agentGen() };
  useLivePreview.setState({ draft: null });
}

function enabled() {
  const s = useIde.getState();
  return s.liveEditor && s.workspaceEpoch === scope.epoch && agentGen() === scope.generation && !agentAborted();
}

function preview(draft: Preview) {
  if (!enabled()) return;
  pending = { ...draft, content: draft.content.slice(0, 1_500_000) };
  timer ??= setTimeout(() => {
    timer = undefined;
    if (enabled()) useLivePreview.setState({ draft: pending });
    pending = null;
  }, 50);
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
    const draft = useLivePreview.getState().draft;
    if (draft && s.files[draft.path] !== prev.files[draft.path]) {
      bases.delete(draft.path);
      useLivePreview.setState({ draft: null });
    }
  }
});
