import { useIde } from "@/store/ide";

export type Jump = { path: string; line: number };

export function setGotoMark(j: Jump): void {
  (window as unknown as { __anvilGoto?: Jump & { epoch: number } }).__anvilGoto = { ...j, epoch: useIde.getState().workspaceEpoch };
  window.dispatchEvent(new Event("anvil-jump"));
}

export function gotoFile(path: string, line: number, record = true): void {
  if (record) useIde.getState().pushJump();
  setGotoMark({ path, line });
  useIde.getState().openFile(path);
  if (record) {
    const st = useIde.getState();
    const stack = st.jumpStack.slice(0, st.jumpIndex + 1);
    if (stack.at(-1)?.path !== path || stack.at(-1)?.line !== line) stack.push({ path, line });
    const next = stack.slice(-40);
    useIde.setState({ jumpStack: next, jumpIndex: next.length - 1 });
  }
}
