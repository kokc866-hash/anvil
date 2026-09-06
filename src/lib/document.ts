import { useIde } from "@/store/ide";

/** Async work belongs to a particular workspace and document revision. */
export function captureDocument(path: string) {
  const s = useIde.getState();
  return { path, content: s.files[path], epoch: s.workspaceEpoch, cwd: s.workspaceCwd };
}

export function documentUnchanged(snap: ReturnType<typeof captureDocument>): boolean {
  const s = useIde.getState();
  return s.workspaceEpoch === snap.epoch && s.workspaceCwd === snap.cwd && s.files[snap.path] === snap.content;
}

export function applyDocument(snap: ReturnType<typeof captureDocument>, content: string): boolean {
  if (!documentUnchanged(snap)) return false;
  useIde.getState().setContent(snap.path, content);
  return true;
}

/** Retain useful undo points without multiplying large documents forty times. */
export function pushUndo(stack: string[], before: string): string[] {
  const next = stack.at(-1) === before ? [...stack] : [...stack, before];
  let bytes = 0;
  let start = next.length;
  while (start > 0 && next.length - start < 40) {
    const size = next[start - 1].length * 2;
    if (start < next.length && bytes + size > 4_000_000) break;
    bytes += size;
    start--;
  }
  return next.slice(start);
}
