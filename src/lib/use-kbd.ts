import { useIde } from "@/store/ide";
import { formatChord, KEY_DEFAULTS, type KeyId } from "./keymap";

export function useKbd(id: KeyId): string {
  return useIde((s) => formatChord(s.keyMap[id] ?? KEY_DEFAULTS[id]));
}

export function kbdOf(id: KeyId): string {
  const map = useIde.getState().keyMap;
  return formatChord(map[id] ?? KEY_DEFAULTS[id]);
}
