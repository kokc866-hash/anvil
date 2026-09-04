export type KeyId =
  | "openFile"
  | "palette"
  | "newFile"
  | "newFolder"
  | "save"
  | "saveAll"
  | "settings"
  | "run"
  | "runWin"
  | "debug"
  | "debugStop"
  | "debugStep"
  | "breakpoint"
  | "search"
  | "find"
  | "gotoLine"
  | "gotoDef"
  | "peek"
  | "inline"
  | "askSel"
  | "output"
  | "trail"
  | "files"
  | "agent"
  | "git"
  | "refs"
  | "tests"
  | "memory"
  | "board"
  | "intern"
  | "problems"
  | "closeTab"
  | "reopen"
  | "nextTab"
  | "prevTab"
  | "format"
  | "fontUp"
  | "fontDown"
  | "zoomReset"
  | "replace"
  | "symbols"
  | "dup"
  | "moveUp"
  | "moveDown"
  | "comment"
  | "preview"
  | "fixAgent"
  | "stopAgent"
  | "copyPath"
  | "wrap"
  | "nextProblem"
  | "prevProblem"
  | "focusEditor"
  | "back"
  | "forward";

export type Chord = {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
};

export const KEY_DEFAULTS: Record<KeyId, Chord> = {
  openFile: { key: "p", ctrl: true },
  palette: { key: "p", ctrl: true, shift: true },
  newFile: { key: "n", ctrl: true },
  newFolder: { key: "n", ctrl: true, alt: true },
  save: { key: "s", ctrl: true },
  saveAll: { key: "s", ctrl: true, alt: true },
  settings: { key: ",", ctrl: true },
  run: { key: "Enter", ctrl: true },
  runWin: { key: "Enter", ctrl: true, shift: true },
  debug: { key: "F5" },
  debugStop: { key: "F5", shift: true },
  debugStep: { key: "F10" },
  breakpoint: { key: "F9" },
  search: { key: "f", ctrl: true, shift: true },
  find: { key: "f", ctrl: true },
  gotoLine: { key: "g", ctrl: true },
  gotoDef: { key: "F12" },
  peek: { key: "F12", alt: true },
  inline: { key: "k", ctrl: true },
  askSel: { key: "l", ctrl: true },
  output: { key: "j", ctrl: true },
  trail: { key: "j", ctrl: true, shift: true },
  files: { key: "b", ctrl: true },
  agent: { key: "a", ctrl: true, shift: true },
  git: { key: "g", ctrl: true, shift: true },
  refs: { key: "r", ctrl: true, shift: true },
  tests: { key: "u", ctrl: true, shift: true },
  memory: { key: "m", ctrl: true, shift: true },
  board: { key: "b", ctrl: true, shift: true },
  intern: { key: "i", ctrl: true, shift: true },
  problems: { key: "e", ctrl: true, shift: true },
  closeTab: { key: "w", ctrl: true },
  reopen: { key: "t", ctrl: true, shift: true },
  nextTab: { key: "Tab", ctrl: true },
  prevTab: { key: "Tab", ctrl: true, shift: true },
  format: { key: "f", alt: true, shift: true },
  fontUp: { key: "=", ctrl: true },
  fontDown: { key: "-", ctrl: true },
  zoomReset: { key: "0", ctrl: true },
  replace: { key: "h", ctrl: true },
  symbols: { key: "o", ctrl: true, shift: true },
  dup: { key: "d", ctrl: true, shift: true },
  moveUp: { key: "ArrowUp", alt: true },
  moveDown: { key: "ArrowDown", alt: true },
  comment: { key: "/", ctrl: true },
  preview: { key: "v", ctrl: true, shift: true },
  fixAgent: { key: ".", ctrl: true },
  stopAgent: { key: "Backspace", ctrl: true, shift: true },
  copyPath: { key: "c", alt: true, shift: true },
  wrap: { key: "z", alt: true },
  nextProblem: { key: "F8" },
  prevProblem: { key: "F8", shift: true },
  focusEditor: { key: "1", ctrl: true },
  back: { key: "ArrowLeft", alt: true },
  forward: { key: "ArrowRight", alt: true },
};

export const KEY_GROUPS: { i18n: string; ids: KeyId[] }[] = [
  {
    i18n: "keyGrpFile",
    ids: ["openFile", "newFile", "newFolder", "save", "saveAll", "closeTab", "reopen", "copyPath"],
  },
  {
    i18n: "keyGrpEdit",
    ids: ["find", "replace", "gotoLine", "gotoDef", "peek", "symbols", "format", "dup", "moveUp", "moveDown", "comment", "inline"],
  },
  {
    i18n: "keyGrpView",
    ids: [
      "files",
      "search",
      "agent",
      "trail",
      "output",
      "preview",
      "git",
      "refs",
      "tests",
      "memory",
      "board",
      "intern",
      "problems",
      "settings",
      "fontUp",
      "fontDown",
      "zoomReset",
      "wrap",
      "nextTab",
      "prevTab",
    ],
  },
  {
    i18n: "keyGrpRun",
    ids: ["run", "runWin", "debug", "debugStop", "debugStep", "breakpoint", "nextProblem", "prevProblem", "stopAgent", "fixAgent"],
  },
  {
    i18n: "keyGrpNav",
    ids: ["palette", "askSel", "focusEditor", "back", "forward"],
  },
];

export const KEY_LABEL: Record<KeyId, string> = {
  openFile: "keyOpenFile",
  palette: "keyPalette",
  newFile: "newFile",
  newFolder: "newFolder",
  save: "save",
  saveAll: "keySaveAll",
  settings: "settings",
  run: "run",
  runWin: "keyRunWin",
  debug: "debug",
  debugStop: "keyDebugStop",
  debugStep: "keyStep",
  breakpoint: "keyBreakpoint",
  search: "search",
  find: "findInFile",
  gotoLine: "keyGotoLine",
  gotoDef: "keyGotoDef",
  peek: "keyPeek",
  inline: "keyInline",
  askSel: "keyAskSel",
  output: "output",
  trail: "trail",
  files: "keyExplorer",
  agent: "agent",
  git: "git",
  refs: "refs",
  tests: "tests",
  memory: "memory",
  board: "board",
  intern: "intern",
  problems: "problems",
  closeTab: "keyCloseTab",
  reopen: "keyReopen",
  nextTab: "keyNextTab",
  prevTab: "keyPrevTab",
  format: "keyFormat",
  fontUp: "keyFontUp",
  fontDown: "keyFontDown",
  zoomReset: "keyZoomReset",
  replace: "keyReplace",
  symbols: "keySymbol",
  dup: "keyDup",
  moveUp: "keyMoveUp",
  moveDown: "keyMoveDown",
  comment: "keyComment",
  preview: "preview",
  fixAgent: "keyFixAgent",
  stopAgent: "keyStopAgent",
  copyPath: "copyPath",
  wrap: "wordWrap",
  nextProblem: "keyNextProblem",
  prevProblem: "keyPrevProblem",
  focusEditor: "keyFocusEditor",
  back: "keyBack",
  forward: "keyFwd",
};

export const KEY_ROWS: { id: KeyId; i18n: string }[] = KEY_GROUPS.flatMap((g) =>
  g.ids.map((id) => ({ id, i18n: KEY_LABEL[id] })),
);

/** Auch in Eingabefeldern (Chat, Suche, Monaco-Textarea). */
export const KEY_IN_FIELD: KeyId[] = [
  "save",
  "saveAll",
  "settings",
  "palette",
  "openFile",
  "run",
  "runWin",
  "closeTab",
  "files",
  "agent",
  "output",
  "trail",
  "fontUp",
  "fontDown",
  "zoomReset",
  "stopAgent",
  "nextTab",
  "prevTab",
  "find",
  "replace",
  "gotoLine",
];

export function chordFromEvent(e: KeyboardEvent): Chord {
  let key = e.key;
  if (key === " ") key = "Space";
  if (key.length === 1) key = key.toLowerCase() === key.toUpperCase() ? key : key.toLowerCase();
  if (key === "+") key = "=";
  return {
    key,
    ctrl: e.ctrlKey || e.metaKey || undefined,
    shift: e.shiftKey || undefined,
    alt: e.altKey || undefined,
  };
}

export function chordsEqual(a: Chord, b: Chord): boolean {
  const norm = (c: Chord) =>
    `${c.ctrl ? 1 : 0}${c.alt ? 1 : 0}${c.shift ? 1 : 0}:${c.key.toLowerCase()}`;
  return norm(a) === norm(b);
}

function modName() {
  if (typeof navigator === "undefined") return "Ctrl";
  return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl";
}

export function formatChord(c: Chord): string {
  const parts: string[] = [];
  if (c.ctrl) parts.push(modName());
  if (c.alt) parts.push("Alt");
  if (c.shift) parts.push("Shift");
  const k =
    c.key === " " || c.key === "Space"
      ? "Space"
      : c.key === "ArrowLeft"
        ? "←"
        : c.key === "ArrowRight"
          ? "→"
          : c.key === "ArrowUp"
            ? "↑"
            : c.key === "ArrowDown"
              ? "↓"
              : c.key === "Escape"
                ? "Esc"
                : c.key === "Backspace"
                  ? "⌫"
                  : c.key.length === 1
                    ? c.key.toUpperCase()
                    : c.key;
  parts.push(k);
  return parts.join("+");
}

export function normalizeKeyMap(raw: unknown): Record<KeyId, Chord> {
  const out = { ...KEY_DEFAULTS };
  if (!raw || typeof raw !== "object") return out;
  for (const id of Object.keys(KEY_DEFAULTS) as KeyId[]) {
    const v = (raw as Record<string, Chord>)[id];
    if (v && typeof v.key === "string" && v.key) out[id] = { key: v.key, ctrl: v.ctrl, shift: v.shift, alt: v.alt };
  }
  return out;
}

export function matchKey(e: KeyboardEvent, map: Record<KeyId, Chord>): KeyId | null {
  const got = chordFromEvent(e);
  if (got.key === "Escape") return null;
  for (const id of Object.keys(KEY_DEFAULTS) as KeyId[]) {
    if (chordsEqual(got, map[id] ?? KEY_DEFAULTS[id])) return id;
  }
  return null;
}

export function chordOwner(map: Record<KeyId, Chord>, chord: Chord, except?: KeyId): KeyId | null {
  for (const id of Object.keys(KEY_DEFAULTS) as KeyId[]) {
    if (id === except) continue;
    if (chordsEqual(chord, map[id] ?? KEY_DEFAULTS[id])) return id;
  }
  return null;
}

export function typingInField(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return Boolean(el.isContentEditable);
}
