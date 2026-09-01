import { completeText } from "@/lib/complete";
import { formatCode } from "@/lib/format";
import { tokenize, type SyntaxToken } from "@/lib/syntax";
import { fetchWeb } from "@/lib/web-fetch";
import { useIde } from "@/store/ide";
import { clearPluginHooks, onPlugin, type PluginEvent } from "./events";

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

function bump() {
  version += 1;
  for (const l of listeners) l();
}

function isEnabled(id: string): boolean {
  const st = useIde.getState();
  if (id.startsWith("ws:")) return st.pluginKnown.includes(id) && !st.pluginDisabled.includes(id);
  return !st.pluginDisabled.includes(id);
}

function makeApi(plugin: string, trust = true): PluginApi {
  return {
    command: (cmd) => {
      commands = [...commands.filter((c) => c.id !== cmd.id), { ...cmd, plugin }];
      bump();
    },
    notify: (msg) => useIde.getState().setNotice(msg),
    files: () => (trust ? useIde.getState().files : {}),
    read: (path) => {
      if (!trust && !path.startsWith("plugins/")) return undefined;
      return useIde.getState().files[path];
    },
    write: (path, content) => {
      if (!trust) {
        useIde.getState().setNotice("Plugin ohne @trust darf nicht schreiben");
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
    prompt: (msg, fallback) => window.prompt(msg, fallback ?? ""),
    highlight: (code, lang) => tokenize(code, lang || "plaintext"),
    cursor: () => useIde.getState().cursor,
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
      const g = (glob ?? "").toLowerCase().replace(/\*/g, "");
      const hits: { path: string; line: number; text: string }[] = [];
      for (const [path, content] of Object.entries(useIde.getState().files)) {
        if (g && !path.toLowerCase().includes(g)) continue;
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
      return fetchWeb({ data: { url } });
    },
    remove: (path) => {
      if (!trust) {
        useIde.getState().setNotice("Plugin ohne @trust darf nicht löschen");
        return;
      }
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
      useIde.getState().setPluginProblems(items.map((x) => ({ ...x, source: plugin })));
    },
  };
}

export function registerBuiltin(def: Builtin) {
  if (builtins.some((b) => b.id === def.id)) return;
  builtins.push(def);
}

export function activateBuiltins() {
  for (const u of unhooks) u();
  unhooks.length = 0;
  clearPluginHooks();
  commands = commands.filter((c) => extra.some((e) => e.id === c.plugin));
  for (const b of builtins) {
    if (isEnabled(b.id)) b.activate(makeApi(b.id));
  }
  bump();
}

export function loadWorkspacePlugins(files: Record<string, string>) {
  extra.length = 0;
  commands = commands.filter((c) => builtins.some((b) => b.id === c.plugin));
  for (const [path, code] of Object.entries(files)) {
    if (!/^plugins\/.+\.js$/.test(path)) continue;
    const id = `ws:${path}`;
    const head = code.split("\n").slice(0, 8).join("\n");
    const desc =
      head.match(/@desc\s+(.+)/)?.[1]?.trim() ||
      head.match(/^\/\/\s*(.+)/)?.[1]?.trim() ||
      "Workspace-Plugin";
    const trust = /@trust\b/.test(head);
    extra.push({
      id,
      name: path.slice("plugins/".length).replace(/\.js$/, ""),
      description: desc + (trust ? "" : " (lesen)"),
      builtin: false,
      category: "workspace",
      path,
    });
    const st = useIde.getState();
    if (!st.pluginKnown.includes(id)) {
      st.setPluginKnown([...st.pluginKnown, id]);
      if (!st.pluginDisabled.includes(id)) st.togglePlugin(id);
      continue;
    }
    if (!isEnabled(id)) continue;
    if (!trust) continue;
    try {
      const fn = new Function("anvil", `${code}\n;if (typeof activate === "function") activate(anvil);`);
      fn(makeApi(id, trust));
    } catch (err) {
      useIde.getState().setNotice(`Plugin ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  bump();
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
replace(path, old, next, all?)
grep(query, glob?)
run(path?) / debug()
fetch(url) → {ok, text}
agent(prompt)              Chat starten
complete(prompt) → Text    Modell ohne Tools
format(path, code)
highlight(code, lang)
cursor() → {line, col}
config.get/set(key, value)
problems([{path, line, text}])
on(event, fn)  save | open | run | change | debug | agent

Workspace: plugins/*.js  mit activate(anvil)
VS Code: .vsix / plugins/*/package.json / .vscode/*.code-snippets
  — nur contributes.snippets, languages, Kommentare. Kein vscode-Modul.
`;
