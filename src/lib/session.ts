export const CHAT_RAM = 400;
export const CHAT_PERSIST = 128;
export const CHAT_PACK = 48;
export const UNDO_OPEN = 12;
export const UNDO_CLOSED = 2;

export const COMPACT_MARK = "Older history (compact";

export type SessionJournal = {
  goal: string;
  files: string[];
  decisions: string[];
  corrections: string[];
  open: string[];
  notes: string;
  at: number;
  turns: number;
};

export const EMPTY_JOURNAL: SessionJournal = {
  goal: "",
  files: [],
  decisions: [],
  corrections: [],
  open: [],
  notes: "",
  at: 0,
  turns: 0,
};

const PATH_RE =
  /(?:^|[\s`\[('"])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z][\w]*|[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|php|rb|md|html|css|json|vue|svelte|sql|toml|ya?ml))/g;
const SKIP_FILE = /(^|\/)(node_modules|\.git|\.env|package-lock|pnpm-lock|yarn\.lock)/i;
const CORRECT_RE = /\b(nicht so|nicht mehr|nicht verwenden|kein[e]? |ohne |statt |don't|do not|never |lass das|no more|nicht [A-ZÄÖÜa-zäöü])/i;
const OPEN_RE = /\b(todo|offen|noch |fehlt|left to|next:|danach )\b/i;

export function trimList<T>(xs: T[], cap: number): T[] {
  return xs.length <= cap ? xs : xs.slice(-cap);
}

export function messageText(m: { content?: unknown }): string {
  const c = m.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((p) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object" && "text" in p) return String((p as { text?: unknown }).text ?? "");
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return c == null ? "" : String(c);
}

export function isJournalEmpty(j: SessionJournal | null | undefined): boolean {
  if (!j) return true;
  return !j.goal && !j.files.length && !j.decisions.length && !j.corrections.length && !j.open.length && !j.notes;
}

export function normalizeJournal(raw: unknown): SessionJournal {
  if (!raw || typeof raw !== "object") return { ...EMPTY_JOURNAL };
  const o = raw as Record<string, unknown>;
  return {
    goal: String(o.goal ?? "").slice(0, 240),
    files: uniqCap(arr(o.files), 48),
    decisions: uniqCap(arr(o.decisions), 16),
    corrections: uniqCap(arr(o.corrections), 16),
    open: uniqCap(arr(o.open), 10),
    notes: String(o.notes ?? "").slice(-3000),
    at: typeof o.at === "number" && Number.isFinite(o.at) ? o.at : 0,
    turns: typeof o.turns === "number" && Number.isFinite(o.turns) ? Math.max(0, Math.round(o.turns)) : 0,
  };
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
}

function uniqCap(xs: string[], cap: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of xs) {
    const k = raw.replace(/\s+/g, " ").trim().slice(0, 180);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= cap) break;
  }
  return out;
}

export function harvestPaths(text: string, into?: Set<string>): string[] {
  const out = into ?? new Set<string>();
  PATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_RE.exec(text))) {
    const p = m[1].replace(/\\/g, "/").replace(/^\/+/, "");
    if (!p || SKIP_FILE.test(p) || p.length > 180) continue;
    out.add(p);
    if (out.size >= 64) break;
  }
  return [...out];
}

function toolPaths(m: Record<string, unknown>, into: Set<string>) {
  const calls = m.tool_calls;
  if (!Array.isArray(calls)) return;
  for (const raw of calls) {
    if (!raw || typeof raw !== "object") continue;
    const fn = (raw as { function?: { name?: string; arguments?: string } }).function;
    const args = String(fn?.arguments ?? "");
    harvestPaths(args, into);
    const name = String(fn?.name ?? "");
    if (name === "write_file" || name === "edit_file" || name === "read_file" || name === "append_file") {
      try {
        const j = JSON.parse(args) as { path?: unknown };
        if (typeof j.path === "string") harvestPaths(j.path, into);
      } catch {
        /* */
      }
    }
  }
}

export function extractJournal(
  messages: Array<{
    role?: unknown;
    content?: unknown;
    tool_calls?: unknown;
    steps?: Array<{ name?: string; path?: string; detail?: string }>;
  }>,
  prev?: SessionJournal | null,
): SessionJournal {
  const base = normalizeJournal(prev);
  const files = new Set<string>(base.files);
  const decisions: string[] = [...base.decisions];
  const corrections: string[] = [...base.corrections];
  const open: string[] = [...base.open];
  const noteBits: string[] = [];
  let goal = base.goal;
  let users = 0;

  for (const m of messages) {
    const role = String(m.role ?? "");
    const text = messageText(m);
    harvestPaths(text, files);
    toolPaths(m as Record<string, unknown>, files);
    if (Array.isArray(m.steps)) {
      for (const s of m.steps) {
        if (s.path) harvestPaths(s.path, files);
        if (s.detail) harvestPaths(s.detail, files);
      }
    }
    if (text.startsWith(COMPACT_MARK)) {
      const body = text.replace(/^Older history \(compact[^)]*\):\s*/, "").trim();
      if (body) noteBits.push(body.slice(0, 1200));
      continue;
    }
    if (role === "user") {
      users += 1;
      const task = text.includes("Auftrag:") ? text.slice(text.lastIndexOf("Auftrag:") + 8).trim() : text.trim();
      const one = task.replace(/\s+/g, " ").slice(0, 240);
      if (one.length >= 8 && !one.startsWith("[") && !goal) goal = one;
      if (CORRECT_RE.test(text)) corrections.push(text.replace(/\s+/g, " ").trim().slice(0, 160));
      if (OPEN_RE.test(text) && one.length < 160) open.push(one);
    } else if (role === "assistant") {
      const one = text.replace(/\s+/g, " ").trim();
      if (/\b(stattdessen|wir nutzen| fest:|decision:)\b/i.test(one)) {
        decisions.push(one.slice(0, 160));
      }
    }
  }

  const notes = [base.notes, ...noteBits]
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .slice(-3000);

  return {
    goal,
    files: uniqCap([...files], 48),
    decisions: uniqCap(decisions, 16),
    corrections: uniqCap(corrections, 16),
    open: uniqCap(open, 10),
    notes,
    at: Date.now(),
    turns: Math.max(base.turns, users, base.turns + (users ? 1 : 0)),
  };
}

export function mergeJournal(a: SessionJournal | null | undefined, b: SessionJournal | Partial<SessionJournal> | null | undefined): SessionJournal {
  const left = normalizeJournal(a);
  const right = normalizeJournal(b);
  if (isJournalEmpty(right)) return left;
  if (isJournalEmpty(left)) return right;
  return {
    goal: right.goal || left.goal,
    files: uniqCap([...left.files, ...right.files], 48),
    decisions: uniqCap([...left.decisions, ...right.decisions], 16),
    corrections: uniqCap([...left.corrections, ...right.corrections], 16),
    open: uniqCap([...right.open, ...left.open], 10),
    notes: `${left.notes}\n${right.notes}`.replace(/\n{3,}/g, "\n\n").trim().slice(-3000),
    at: Math.max(left.at, right.at) || Date.now(),
    turns: Math.max(left.turns, right.turns),
  };
}

export function formatJournal(j: SessionJournal): string {
  const n = normalizeJournal(j);
  if (isJournalEmpty(n)) return "";
  return [
    n.goal ? `Ziel: ${n.goal}` : "",
    n.files.length ? `Dateien: ${n.files.join(", ")}` : "",
    n.decisions.length ? `Fest: ${n.decisions.join(" · ")}` : "",
    n.corrections.length ? `Nicht: ${n.corrections.join(" · ")}` : "",
    n.open.length ? `Offen: ${n.open.join(" · ")}` : "",
    n.notes ? n.notes : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function journalPrompt(j: SessionJournal | null | undefined): string {
  if (!j || isJournalEmpty(j)) return "";
  const body = formatJournal(j);
  if (!body.trim()) return "";
  const runden = j.turns ? `, ${j.turns} Runden` : "";
  return `Sitzung (gilt weiter, auch nach Compacting${runden}):\n${body}`;
}

export function sessionFileText(j: SessionJournal, chatLen = 0): string {
  const body = formatJournal(j) || "(leer)";
  return `# Anvil Sitzung\n\n${body}\n\nNachrichten: ${chatLen}\nStand: ${j.at ? new Date(j.at).toISOString() : ""}\n`;
}

export async function persistSessionDisk(): Promise<void> {
  const { useIde } = await import("@/store/ide");
  const st = useIde.getState();
  const cwd = st.workspaceCwd?.trim();
  if (!cwd) return;
  const text = sessionFileText(st.sessionJournal ?? EMPTY_JOURNAL, st.chat.length);
  try {
    const { companionWriteFile } = await import("@/lib/companion");
    await companionWriteFile(".anvil/session.md", text, cwd);
  } catch {
    /* companion down */
  }
}

export type ChatTurn = {
  role: "user" | "assistant" | string;
  content: string;
  images?: string[];
};

export function packChatHistory(
  chat: ChatTurn[],
  last: { content: string; images?: string[] },
  cap = CHAT_PACK,
): { role: "user" | "assistant"; content: string; images?: string[] }[] {
  const rows: ChatTurn[] = chat.filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ ...m }));
  if (rows.length && rows[rows.length - 1]?.role === "user") {
    rows[rows.length - 1] = { role: "user", content: last.content, images: last.images };
  } else {
    rows.push({ role: "user", content: last.content, images: last.images });
  }
  const sliced = rows.slice(-Math.max(8, cap));
  return sliced.map((m, i, arr) => {
    const keep = i >= arr.length - 8;
    const content = keep ? m.content : m.content.slice(0, 1800);
    return {
      role: m.role === "assistant" ? "assistant" : "user",
      content,
      images: m.images,
    };
  });
}

export function persistChat<T extends { role: string; content: string; thinking?: string; steps?: unknown[]; images?: unknown[]; lastRun?: { stdout: string; stderr: string; running?: boolean }; plan?: unknown[] }>(
  chat: T[],
): T[] {
  const kept = chat
    .filter(
      (m) =>
        m.role !== "assistant" ||
        Boolean((m.content || "").trim() || m.thinking || m.steps?.length || m.lastRun || m.plan?.length),
    )
    .slice(-CHAT_PERSIST);
  return kept.map((m, i, arr) => {
    const old = i < arr.length - 8;
    return {
      ...m,
      content: m.content.slice(0, old ? 4000 : 12_000),
      thinking: m.thinking?.slice(0, old ? 400 : 1200),
      steps: Array.isArray(m.steps) ? m.steps.slice(-16) : m.steps,
      images: m.role === "user" ? (m.images as unknown[] | undefined)?.slice(0, 2) : undefined,
      lastRun: m.lastRun
        ? {
            ...m.lastRun,
            stdout: m.lastRun.stdout.slice(0, 400),
            stderr: m.lastRun.stderr.slice(0, 400),
            running: false,
          }
        : undefined,
    };
  });
}

export function digestOldMessages(old: Record<string, unknown>[], maxChars: number): string {
  const harvested = extractJournal(old);
  const structured = formatJournal(harvested);
  const prev = old
    .filter((m) => messageText(m).startsWith(COMPACT_MARK))
    .map((m) => messageText(m).replace(/^Older history \(compact[^)]*\):\s*/, ""))
    .join("\n")
    .slice(0, Math.floor(maxChars * 0.35));
  const lines: string[] = [];
  for (const m of old) {
    const text = messageText(m);
    if (text.startsWith(COMPACT_MARK)) continue;
    const role = String(m.role ?? "user");
    if (role === "tool") {
      const head = text.split("\n")[0]?.slice(0, 100) || "tool";
      lines.push(`tool: ${head}`);
      continue;
    }
    const one = text.replace(/\s+/g, " ").trim().slice(0, 180);
    if (one) lines.push(`${role}: ${one}`);
  }
  return [structured, prev, lines.join("\n")].filter(Boolean).join("\n").slice(0, maxChars);
}

export async function pruneSession(): Promise<void> {
  const { useIde } = await import("@/store/ide");
  const st = useIde.getState();
  if (st.agentBusy) return;
  const open = new Set(st.openPaths);
  let undoChanged = false;
  const undo: Record<string, string[]> = {};
  for (const [path, stack] of Object.entries(st.undo)) {
    if (!stack.length) continue;
    const cap = open.has(path) ? UNDO_OPEN : UNDO_CLOSED;
    const next = stack.length > cap ? stack.slice(-cap) : stack;
    if (next.length) undo[path] = next;
    if (next.length !== stack.length) undoChanged = true;
  }
  let journal = st.sessionJournal ?? EMPTY_JOURNAL;
  if (st.chat.length > CHAT_RAM) {
    const dropped = st.chat.slice(0, st.chat.length - CHAT_RAM);
    journal = mergeJournal(journal, extractJournal(dropped, journal));
  }
  const chat = trimList(st.chat, CHAT_RAM);
  const mcpLog = trimList(st.mcpLog, 40);
  const lspLog = trimList(st.lspLog, 40);
  const journalChanged = journal !== st.sessionJournal && (journal.at !== st.sessionJournal?.at || journal.turns !== st.sessionJournal?.turns);
  if (!undoChanged && chat === st.chat && mcpLog === st.mcpLog && lspLog === st.lspLog && !journalChanged) return;
  useIde.setState({
    undo: undoChanged ? undo : st.undo,
    chat,
    mcpLog,
    lspLog,
    sessionJournal: journal,
  });
  void persistSessionDisk();
}

