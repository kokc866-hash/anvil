import { completeText } from "@/lib/complete";
import { formatCode } from "@/lib/format";
import { tokenize, type SyntaxToken } from "@/lib/syntax";
import { fetchWeb, readWebPage } from "@/lib/web-fetch";
import { isSecretPath, omitSecrets } from "@/lib/ref";
import { skipSearchPath } from "@/lib/search";
import { matchGlob } from "@/lib/harness-graph";
import { useIde } from "@/store/ide";
import { clearPluginHooks, onPlugin, type PluginEvent } from "./events";
import { isWorkspacePluginPath, pluginTrustFromHead, prunePluginIds } from "./util";

export type PluginCommand = {
  id: string;
  title: string;
  plugin: string;
  run: () => void | Promise<void>;
};

export type PluginInfo = {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  category?: string;
  version?: string;
  path?: string;
};

export type PluginApi = {
  command: (cmd: { id: string; title: string; run: () => void | Promise<void> }) => void;
  notify: (msg: string) => void;
  files: () => Record<string, string>;
  read: (path: string) => string | undefined;
  write: (path: string, content: string) => void;
  open: (path: string) => void;
  active: () => string | null;
  format: (path: string, code: string) => Promise<string>;
  output: (text: string, ok?: boolean) => void;
  on: (event: PluginEvent, fn: (payload: unknown) => void) => void;
  status: (text: string) => void;
  prompt: (msg: string, fallback?: string) => string | null;
  highlight: (code: string, lang?: string) => SyntaxToken[];
  cursor: () => { line: number; col: number };
  range: () => { from: number; to: number };
  insert: (text: string) => void;
  replace: (path: string, old: string, next: string, all?: boolean) => boolean;
  grep: (query: string, glob?: string) => { path: string; line: number; text: string }[];
  run: (path?: string) => void;
  debug: () => void;
  fetch: (url: string) => Promise<{ ok: boolean; text: string }>;
  remove: (path: string) => void;
  mkdir: (path: string) => void;
  agent: (prompt: string) => void;
  complete: (prompt: string) => Promise<string>;
  config: { get: (key: string, fallback?: unknown) => unknown; set: (key: string, value: unknown) => void };
  problems: (items: { path: string; line: number; text: string }[]) => void;
};

type Builtin = PluginInfo & { activate: (api: PluginApi) => void };

const builtins: Builtin[] = [];
const extra: PluginInfo[] = [];
let commands: PluginCommand[] = [];
let version = 0;
const listeners = new Set<() => void>();
const unhooks: Array<() => void> = [];
let reloading = false;

function bump() {
  version += 1;
  for (const l of listeners) l();
}

function isEnabled(id: string): boolean {
  const st = useIde.getState();
  if (id.startsWith("ws:")) return st.pluginKnown.includes(id) && !st.pluginDisabled.includes(id);
  return !st.pluginDisabled.includes(id);
}

function noticeErr(label: string, err: unknown) {
  useIde.getState().setNotice(`${label}: ${err instanceof Error ? err.message : String(err)}`);
}

async function pluginFetch(url: string): Promise<{ ok: boolean; text: string }> {
  try {
    const r = await fetchWeb({ data: { url } });
    if (r && typeof r === "object" && "ok" in r) return r;
  } catch {
    /* Electron has no TanStack server fn — fall through */
  }
  return readWebPage(url);
}

function makeApi(plugin: string, trust = true): PluginApi {
  return {
    command: (cmd) => {
      const id = cmd.id.includes(".") || cmd.id.includes(":") ? cmd.id : `${plugin}.${cmd.id}`;
      const run = () => {
        try {
          return cmd.run();
        } catch (err) {
          noticeErr(plugin, err);
        }
      };
      commands = [...commands.filter((c) => c.id !== id), { ...cmd, id, plugin, run }];
      bump();
    },
    notify: (msg) => useIde.getState().setNotice(msg),
    files: () => (trust ? omitSecrets(useIde.getState().files) : {}),
    read: (path) => {
      if (!trust && !path.startsWith("plugins/")) return undefined;
      if (isSecretPath(path)) return undefined;
      return useIde.getState().files[path];
    },
    write: (path, content) => {
      if (!trust) {
        useIde.getState().setNotice("Plugin ohne @trust darf nicht schreiben");
        return;
      }
      if (isSecretPath(path)) {
        useIde.getState().setNotice("Geheimnis — nicht schreiben");
        return;
      }
      useIde.getState().writeFile(path, content);
    },
    open: (path) => useIde.getState().openFile(path),
    active: () => useIde.getState().activePath,
    format: formatCode,
    output: (text, ok = true) =>
      useIde.getState().pushOutput({
        ok,
        stdout: ok ? text : "",
        stderr: ok ? "" : text,
        duration: 0,
        label: plugin,
      }),
    on: (event, fn) => {
      unhooks.push(onPlugin(event, fn));
    },
    status: (text) => useIde.getState().setPluginStatus(text),
    prompt: (msg, fallback) => (typeof window !== "undefined" ? window.prompt(msg, fallback ?? "") : fallback ?? null),
    highlight: (code, lang) => tokenize(code, lang || "plaintext"),
    cursor: () => useIde.getState().cursor,
    range: () => {
      const s = useIde.getState().selection ?? {
        startLine: useIde.getState().cursor.line,
        endLine: useIde.getState().cursor.line,
        startCol: 1,
        endCol: 1,
      };
      return { from: Math.min(s.startLine, s.endLine), to: Math.max(s.startLine, s.endLine) };
    },
    insert: (text) => {
      if (!trust) {
        useIde.getState().setNotice("Plugin ohne @trust darf nicht schreiben");
        return;
      }
      const st = useIde.getState();
      const path = st.activePath;
      if (!path) return;
      const src = st.files[path] ?? "";
      const lines = src.split("\n");
      const i = Math.max(0, Math.min(lines.length - 1, st.cursor.line - 1));
      const col = Math.max(0, st.cursor.col - 1);
      const line = lines[i] ?? "";
      lines[i] = line.slice(0, col) + text + line.slice(col);
      st.writeFile(path, lines.join("\n"));
    },
    replace: (path, old, next, all) => {
      if (!trust) return false;
      const cur = useIde.getState().files[path];
      if (cur == null || !old || !cur.includes(old)) return false;
      useIde.getState().writeFile(path, all ? cur.split(old).join(next) : cur.replace(old, next));
      return true;
    },
    grep: (query, glob) => {
      if (!trust) return [];
      let re: RegExp | null = null;
      try {
        re = new RegExp(query, "i");
      } catch {
        re = null;
      }
      const q = query.toLowerCase();
      const g = (glob ?? "").trim();
      const hits: { path: string; line: number; text: string }[] = [];
      for (const [path, content] of Object.entries(useIde.getState().files)) {
        if (skipSearchPath(path)) continue;
        if (g && !matchGlob(path, g) && !matchGlob(path.split("/").pop() ?? "", g)) continue;
        content.split("\n").forEach((line, i) => {
          const ok = re ? re.test(line) : line.toLowerCase().includes(q);
          if (ok && hits.length < 80) hits.push({ path, line: i + 1, text: line.trim().slice(0, 200) });
        });
      }
      return hits;
    },
    run: (path) => {
      if (!trust) {
        useIde.getState().setNotice("Plugin ohne @trust darf nicht starten");
        return;
      }
      if (path) useIde.getState().openFile(path);
      window.dispatchEvent(new Event("anvil-run"));
    },
    debug: () => {
      if (!trust) return;
      window.dispatchEvent(new Event("anvil-debug"));
    },
    fetch: async (url) => {
      if (!trust) return { ok: false, text: "Plugin ohne @trust darf nicht laden" };
      return pluginFetch(url);
    },
    remove: (path) => {
      if (!trust) {
        useIde.getState().setNotice("Plugin ohne @trust darf nicht löschen");
        return;
      }
      if (isSecretPath(path)) return;
      useIde.getState().deleteFile(path);
    },
    mkdir: (path) => {
      if (!trust) return;
      useIde.getState().createFolder(path);
    },
    agent: (prompt) => {
      if (!trust) {
        useIde.getState().setNotice("Plugin ohne @trust darf den Agenten nicht starten");
        return;
      }
      useIde.getState().pushAgent(prompt);
    },
    complete: async (prompt) => {
      if (!trust) {
        useIde.getState().setNotice("Plugin ohne @trust darf das Modell nicht nutzen");
        return "";
      }
      const s = useIde.getState();
      return completeText({
        prompt,
        provider: s.llmProvider,
        baseUrl: s.llmBaseUrl,
        model: s.llmModel,
        apiKey: s.llmApiKey,
      });
    },
    config: {
      get: (key, fallback) => {
        const v = useIde.getState().pluginConfig[`${plugin}.${key}`];
        return v === undefined ? fallback : v;
      },
      set: (key, value) => {
        const st = useIde.getState();
        st.setPluginConfig({ ...st.pluginConfig, [`${plugin}.${key}`]: value });
      },
    },
    problems: (items) => {
      const st = useIde.getState();
      const rest = st.pluginProblems.filter((x) => x.source !== plugin);
      st.setPluginProblems([...rest, ...items.map((x) => ({ ...x, source: plugin }))]);
    },
  };
}

export function registerBuiltin(def: Builtin) {
  if (builtins.some((b) => b.id === def.id)) return;
  builtins.push(def);
}

function ingestWorkspace(files: Record<string, string>) {
  extra.length = 0;
  const live: string[] = [];
  const st0 = useIde.getState();
  let known = st0.pluginKnown.slice();
  let disabled = st0.pluginDisabled.slice();
  for (const [path, code] of Object.entries(files)) {
    if (!isWorkspacePluginPath(path)) continue;
    const id = `ws:${path}`;
    live.push(id);
    const trust = pluginTrustFromHead(code);
    extra.push({
      id,
      name: path.slice("plugins/".length).replace(/\.js$/, ""),
      description:
        (code.split("\n").slice(0, 8).join("\n").match(/@desc\s+(.+)/)?.[1]?.trim() ||
          code.split("\n").slice(0, 8).join("\n").match(/^\/\/\s*(.+)/)?.[1]?.trim() ||
          "Workspace-Plugin") + (trust ? "" : " (lesen)"),
      builtin: false,
      category: "workspace",
      path,
    });
    if (!known.includes(id)) {
      known = [...known, id];
      if (trust && !disabled.includes(id)) disabled = [...disabled, id];
    }
    if (disabled.includes(id)) continue;
    try {
      const fn = new Function("anvil", `${code}\n;if (typeof activate === "function") activate(anvil);`);
      fn(makeApi(id, trust));
    } catch (err) {
      noticeErr(`Plugin ${path}`, err);
    }
  }
  const nextKnown = prunePluginIds(known, "ws:", live);
  const nextDisabled = prunePluginIds(disabled, "ws:", live);
  const st = useIde.getState();
  if (nextKnown.join("\0") !== st.pluginKnown.join("\0")) st.setPluginKnown(nextKnown);
  if (nextDisabled.join("\0") !== st.pluginDisabled.join("\0")) st.setPluginDisabled(nextDisabled);
}

/** Drop hooks, re-activate enabled builtins, then workspace plugins. One entry so file-change cannot leak `anvil.on`. */
export function reloadPlugins(files?: Record<string, string>) {
  if (reloading) return;
  reloading = true;
  try {
    for (const u of unhooks) u();
    unhooks.length = 0;
    clearPluginHooks();
    commands = [];
    extra.length = 0;
    for (const b of builtins) {
      if (!isEnabled(b.id)) continue;
      try {
        b.activate(makeApi(b.id, true));
      } catch (err) {
        noticeErr(`Plugin ${b.id}`, err);
      }
    }
    ingestWorkspace(files ?? useIde.getState().files);
    bump();
  } finally {
    reloading = false;
  }
}

export function activateBuiltins() {
  reloadPlugins();
}

export function loadWorkspacePlugins(files: Record<string, string>) {
  reloadPlugins(files);
}

export function listPlugins(): PluginInfo[] {
  return [...builtins.map(({ activate: _a, ...rest }) => rest), ...extra];
}

export function listCommands(): PluginCommand[] {
  return commands.filter((c) => isEnabled(c.plugin));
}

export function subscribePlugins(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function pluginSnapshot() {
  return version;
}

export const PLUGIN_TEMPLATE = `// @desc Mein Plugin
// @trust  — ohne diese Zeile nur lesen/Status. Mit @trust: schreiben, Agent, Netz.
function activate(anvil) {
  anvil.command({
    id: "beispiel.zeit",
    title: "Uhrzeit einfügen",
    run() {
      anvil.insert(new Date().toLocaleString());
      anvil.notify("Zeitstempel");
    },
  });
  anvil.on("save", (path) => anvil.status("Gespeichert " + path));
}
`;

export const PLUGIN_API_DOC = `Plugin API (anvil)
command({id, title, run})  Befehl (Ctrl+Shift+P)
notify(msg)                Toast
status(text)               Statusleiste
files() / read / write / open / active / remove / mkdir
insert(text)               An der Schreibmarke
range()                    Zeilen from/to (Auswahl)
replace(path, old, next, all?)
grep(query, glob?)         glob: *.py, src/**
run(path?) / debug()
fetch(url) → {ok, text}
agent(prompt)              Chat starten
complete(prompt) → Text    Modell ohne Tools
format(path, code)
highlight(code, lang)
cursor() → {line, col}
config.get/set(key, value)
problems([{path, line, text}])  — merget je Plugin
on(event, fn)  save | open | run | change | debug | agent

Workspace: plugins/*.js mit activate(anvil)
  Ohne @trust in den ersten 8 Zeilen: nur lesen.
  Mit // @trust: voll. Neue @trust-Plugins starten aus, Schalter an = opt-in.
VS Code: .vsix / plugins/*/package.json / .vscode/*.code-snippets
  — contributes.snippets, languages, Kommentare, tmLanguage-Keywords.
  Kein vscode-Modul, kein Language-Server.
`;
