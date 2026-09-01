import { useIde } from "@/store/ide";

export type Jump = { path: string; line: number };

export function setGotoMark(j: Jump): void {
  (window as unknown as { __anvilGoto?: Jump }).__anvilGoto = j;
}

export function gotoFile(path: string, line: number, record = true): void {
  if (record) useIde.getState().pushJump();
  setGotoMark({ path, line });
  useIde.getState().openFile(path);
}
