export const INPUT_ACTIONS = ["left", "right", "up", "down", "ok", "fire", "start"] as const;
export type InputAction = (typeof INPUT_ACTIONS)[number];

export type InputBinding = { keys: string[]; pad: number[] };

export type InputMap = Record<InputAction, InputBinding> & {
  stick: boolean;
  deadzone: number;
};

export const ACTION_LABELS: Record<InputAction, string> = {
  left: "Links",
  right: "Rechts",
  up: "Oben",
  down: "Unten",
  ok: "Bestätigen",
  fire: "Aktion",
  start: "Pause / Menü",
};

export const PAD_LABELS: Record<number, string> = {
  0: "A",
  1: "B",
  2: "X",
  3: "Y",
  4: "LB",
  5: "RB",
  6: "LT",
  7: "RT",
  8: "Select",
  9: "Start",
  10: "L3",
  11: "R3",
  12: "Pad ↑",
  13: "Pad ↓",
  14: "Pad ←",
  15: "Pad →",
};

export const DEFAULT_INPUT_MAP: InputMap = {
  left: { keys: ["ArrowLeft", "a", "A"], pad: [14] },
  right: { keys: ["ArrowRight", "d", "D"], pad: [15] },
  up: { keys: ["ArrowUp", "w", "W"], pad: [12] },
  down: { keys: ["ArrowDown", "s", "S"], pad: [13] },
  ok: { keys: ["Enter", " ", "x", "X"], pad: [0] },
  fire: { keys: [" ", "f", "F"], pad: [1, 7] },
  start: { keys: ["Escape", "p", "P"], pad: [9, 8] },
  stick: true,
  deadzone: 0.28,
};

export function prettyKey(key: string): string {
  if (key === " ") return "Leertaste";
  if (key === "ArrowLeft") return "←";
  if (key === "ArrowRight") return "→";
  if (key === "ArrowUp") return "↑";
  if (key === "ArrowDown") return "↓";
  if (key === "Enter") return "Enter";
  if (key === "Escape") return "Esc";
  if (key === "Shift") return "Shift";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function prettyPad(id: number): string {
  return PAD_LABELS[id] ?? `Taste ${id}`;
}

export function normalizeInputMap(raw: unknown): InputMap {
  const src = raw && typeof raw === "object" ? (raw as Partial<InputMap>) : {};
  const next: InputMap = { ...DEFAULT_INPUT_MAP, stick: src.stick !== false, deadzone: Number(src.deadzone) || DEFAULT_INPUT_MAP.deadzone };
  for (const a of INPUT_ACTIONS) {
    const b = src[a];
    next[a] = {
      keys: Array.isArray(b?.keys) && b.keys.length ? b.keys.map(String) : DEFAULT_INPUT_MAP[a].keys.slice(),
      pad: Array.isArray(b?.pad) ? b.pad.map(Number).filter((n) => Number.isFinite(n)) : DEFAULT_INPUT_MAP[a].pad.slice(),
    };
  }
  next.deadzone = Math.min(0.8, Math.max(0.05, next.deadzone));
  return next;
}
