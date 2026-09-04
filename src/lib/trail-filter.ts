export type TrailStep = {
  id: string;
  name: string;
  detail: string;
  status: "run" | "ok" | "err";
  image?: string;
  path?: string;
  code?: string;
  before?: string;
  at?: number;
  ms?: number;
};

const STEP_HIDE = /^set_plan$/;
const STEP_FOLD = /^(grep|read_file|list_files)$/;

export function hasTrailMsg(m: {
  thinking?: string;
  plan?: unknown[];
  steps?: unknown[];
  changes?: unknown[];
  checkpointId?: string;
  lastRun?: unknown;
  lastTests?: unknown;
  harness?: string;
}): boolean {
  return Boolean(
    m.thinking ||
      m.plan?.length ||
      m.steps?.length ||
      m.changes?.length ||
      m.checkpointId ||
      m.lastRun ||
      m.lastTests ||
      m.harness,
  );
}

export function stepPath(s: { path?: string; detail?: string }): string {
  if (s.path?.trim()) return s.path.trim();
  const d = s.detail ?? "";
  const m = d.match(/([A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,12})/);
  return m?.[1] ?? "";
}

export function shortTrail(d?: string, max = 80): string {
  const t = (d ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function filterTrailSteps(steps: TrailStep[], cap = 80): TrailStep[] {
  const raw = steps.filter((s) => s.status === "run" || !STEP_HIDE.test(s.name)).slice(-cap);
  const out: TrailStep[] = [];
  let pack: TrailStep[] = [];
  const flush = () => {
    if (!pack.length) return;
    const last = pack[pack.length - 1];
    const paths = [...new Set(pack.map((s) => shortTrail(s.detail || stepPath(s), 48)).filter(Boolean))];
    const q = paths[0] || shortTrail(pack[0].detail);
    out.push({
      ...last,
      path: last.path || stepPath(last),
      detail: pack.length === 1 ? q : `${pack.length}× ${paths.slice(0, 3).join(" · ")}`,
    });
    pack = [];
  };
  for (const s of raw) {
    if (STEP_FOLD.test(s.name) && s.status !== "run") {
      if (pack.length && pack[0].name !== s.name) flush();
      pack.push(s);
    } else {
      flush();
      out.push({ ...s, path: s.path || stepPath(s), detail: shortTrail(s.detail) });
    }
  }
  flush();
  return out;
}

const DE: Record<string, string> = {
  write_file: "Schreiben",
  edit_file: "Ändern",
  delete_file: "Löschen",
  rename: "Umbenennen",
  mkdir: "Ordner",
  run_file: "Run",
  engine_run: "Engine",
  engine_detect: "Engine",
  engine_status: "Engine",
  mcp_call: "MCP",
  mcp_list: "MCP",
  git_commit: "Commit",
  git_push: "Push",
  shell: "Shell",
  format_file: "Format",
  grep: "Suche",
  read_file: "Lesen",
  list_files: "Dateien",
  skill_run: "Skill",
  skill_write: "Skill",
  skill_debug: "Skill-Debug",
  skill_patch: "Skill",
  append_file: "Anhängen",
  harness_write: "Harness",
  harness_read: "Harness",
  graph_write: "Graph",
  see_run: "Bild",
  board_read: "Tafel",
  board_write: "Tafel",
  board_open: "Tafel",
};

const EN: Record<string, string> = {
  write_file: "Write",
  edit_file: "Edit",
  delete_file: "Delete",
  rename: "Rename",
  mkdir: "Folder",
  run_file: "Run",
  engine_run: "Engine",
  engine_detect: "Engine",
  engine_status: "Engine",
  mcp_call: "MCP",
  mcp_list: "MCP",
  git_commit: "Commit",
  git_push: "Push",
  shell: "Shell",
  format_file: "Format",
  grep: "Search",
  read_file: "Read",
  list_files: "Files",
  skill_run: "Skill",
  skill_write: "Skill",
  skill_debug: "Skill debug",
  skill_patch: "Skill",
  append_file: "Append",
  harness_write: "Harness",
  harness_read: "Harness",
  graph_write: "Graph",
  see_run: "Frame",
  board_read: "Board",
  board_write: "Board",
  board_open: "Board",
};

export function stepLabel(name: string, locale: "de" | "en" = "de"): string {
  return (locale === "en" ? EN : DE)[name] ?? name;
}
