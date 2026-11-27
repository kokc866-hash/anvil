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
import { confirmApp } from "../confirm";
import { diskWorkspaceHandle } from "../disk";
import { approvalProject, hasStoredApproval, revokeStoredApproval, storeApproval } from "./approvals";

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
  /** The helper API's @trust flag is not a JavaScript isolation boundary. */
  trustApi?: boolean;
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
  config: {
    get: (key: string, fallback?: unknown) => unknown;
    set: (key: string, value: unknown) => void;
  };
  problems: (items: { path: string; line: number; text: string }[]) => void;
};

type Builtin = PluginInfo & { activate: (api: PluginApi) => void };
type PluginActivation = { active: boolean; rollback?: Array<() => void> };

const builtins: Builtin[] = [];
const extra: PluginInfo[] = [];
let commands: PluginCommand[] = [];
let version = 0;
const listeners = new Set<() => void>();
const unhooks: Array<() => void> = [];
let reloading = false;
let apiGeneration = 0;
type Consent = { code: string; trust: boolean; epoch: number; project: string | null; handle: FileSystemDirectoryHandle | null };
const consents = new Map<string, Consent>();
const restoringConsent = new Map<string, Consent>();

function consentFor(code: string): Consent {
  const st = useIde.getState();
  return { code, trust: pluginTrustFromHead(code), epoch: st.workspaceEpoch,
    project: approvalProject(st.workspaceCwd, st.companionUrl), handle: diskWorkspaceHandle() };
}

function sameConsent(consent: Consent, code: string): boolean {
  const now = consentFor(code);
  return consent.code === code && consent.trust === now.trust && consent.epoch === now.epoch
    && consent.project === now.project && consent.handle === now.handle;
}

function bump() {
  version += 1;
  for (const l of listeners) l();
}

export function isPluginEnabled(id: string): boolean {
  const st = useIde.getState();
  if (id.startsWith("ws:")) {
    const consent = consents.get(id), code = st.files[id.slice(3)];
    return code !== undefined && Boolean(consent && sameConsent(consent, code)) && !st.pluginDisabled.includes(id);
  }
  return !st.pluginDisabled.includes(id);
}

/** All renderer JavaScript requires full trust, even when its helper API lacks @trust. */
export async function requestToggleWorkspacePlugin(id: string): Promise<boolean> {
  const path = id.slice(3), before = useIde.getState(), code = before.files[path];
  if (!id.startsWith("ws:") || !isWorkspacePluginPath(path) || code === undefined || before.agentBusy || before.pathOperation) return false;
  const project = approvalProject(before.workspaceCwd, before.companionUrl);
  if (isPluginEnabled(id)) {
    consents.delete(id);
    restoringConsent.delete(id);
    revokeStoredApproval(project, path);
    before.setPluginDisabled([...new Set([...before.pluginDisabled, id])]);
    reloadPlugins();
    return true;
  }
  const expected = consentFor(code), en = before.locale === "en";
  const body = en
    ? `${path}\n\nThis JavaScript runs inside Anvil without a sandbox. It can read and change project files, access saved credentials through the desktop bridge, use the network, run programs and start paid model calls. Only enable code you fully trust.\n\n${expected.trust ? "@trust also enables all anvil helper APIs." : "Without @trust, some anvil helper APIs are restricted; the JavaScript still has full renderer access."}\n\n${project ? "Approval is saved for this project and this exact code and permissions. Changes require new approval." : "Approval lasts for this project session. The browser folder or unsaved project has no stable project path."}`
    : `${path}\n\nDieses JavaScript läuft in Anvil ohne Sandbox. Es kann Projektdateien lesen und ändern, über die Desktop-Brücke gespeicherte Zugangsdaten lesen, das Netzwerk nutzen, Programme ausführen und kostenpflichtige Modellaufrufe starten. Gib nur Code frei, dem du vollständig vertraust.\n\n${expected.trust ? "@trust aktiviert zusätzlich alle anvil-Helfer-APIs." : "Ohne @trust sind einige anvil-Helfer-APIs eingeschränkt; das JavaScript hat trotzdem vollen Renderer-Zugriff."}\n\n${project ? "Die Freigabe wird für dieses Projekt und genau diesen Code samt Berechtigungen gespeichert. Änderungen brauchen eine neue Freigabe." : "Die Freigabe gilt für diese Projektsitzung. Der Browserordner oder das ungespeicherte Projekt hat keinen eindeutigen dauerhaften Projektpfad."}`;
  if (!await confirmApp(body, { title: en ? "Trust and enable plugin" : "Plugin vertrauen und aktivieren", ok: en ? "Trust and enable" : "Vertrauen und aktivieren", danger: true })) return false;
  const unchanged = () => sameConsent(expected, useIde.getState().files[path] ?? "") && !useIde.getState().agentBusy && !useIde.getState().pathOperation;
  if (!unchanged()) return false;
  const saved = await storeApproval(project, path, code);
  if (!unchanged()) { revokeStoredApproval(project, path); return false; }
  consents.set(id, expected);
  restoringConsent.delete(id);
  const st = useIde.getState();
  st.setPluginKnown([...new Set([...st.pluginKnown, id])]);
  st.setPluginDisabled(st.pluginDisabled.filter(value => value !== id));
  reloadPlugins();
  if (project && !saved) st.setNotice(en ? "Enabled for this session. Approval could not be saved." : "Für diese Sitzung aktiviert. Die Freigabe konnte nicht gespeichert werden.");
  return true;
}

function noticeErr(label: string, err: unknown) {
  useIde.getState().setNotice(`${label}: ${err instanceof Error ? err.message : String(err)}`);
}

async function pluginFetch(
  url: string,
  live: () => boolean,
): Promise<{ ok: boolean; text: string }> {
  try {
    const r = await fetchWeb({ data: { url } });
    if (r && typeof r === "object" && "ok" in r) return r;
  } catch {
    /* Electron has no TanStack server fn — fall through */
  }
  if (!live()) return { ok: false, text: "Plugin nicht mehr aktiv" };
  return readWebPage(url);
}

function activatePlugin(plugin: string, trust: boolean, activate: (api: PluginApi) => void): void {
  const rollback: Array<() => void> = [];
  const activation: PluginActivation = { active: true, rollback };
  try {
    activate(makeApi(plugin, trust, activation));
  } catch (err) {
    activation.active = false;
    for (const undo of rollback.reverse()) undo();
    throw err;
  } finally {
    activation.rollback = undefined;
  }
}

function makeApi(plugin: string, trust: boolean, activation: PluginActivation): PluginApi {
  const generation = apiGeneration,
    epoch = useIde.getState().workspaceEpoch;
  // A plugin may retain this API in an asynchronous callback. Reload/removal,
  // disabling, failed activation and project switches revoke that handle, including its results.
  // This is API lifecycle control, not a sandbox for arbitrary JavaScript.
  const live = () =>
    activation.active &&
    generation === apiGeneration &&
    epoch === useIde.getState().workspaceEpoch &&
    isPluginEnabled(plugin);
  return {
    command: (cmd) => {
      if (!live()) return;
      const id = cmd.id.includes(".") || cmd.id.includes(":") ? cmd.id : `${plugin}.${cmd.id}`;
      const run = async () => {
        if (!live()) return;
        try {
          await cmd.run();
        } catch (err) {
          if (live()) noticeErr(plugin, err);
        }
      };
      const previousIndex = commands.findIndex((c) => c.id === id);
      const previous = commands[previousIndex];
      const registered = { ...cmd, id, plugin, run };
      commands = [...commands.filter((c) => c.id !== id), registered];
      activation.rollback?.push(() => {
        if (!commands.includes(registered)) return;
        commands = commands.filter((c) => c !== registered);
        if (previous) commands.splice(Math.min(previousIndex, commands.length), 0, previous);
      });
      bump();
    },
    notify: (msg) => {
      if (live()) useIde.getState().setNotice(msg);
    },
    files: () => (live() && trust ? omitSecrets(useIde.getState().files) : {}),
    read: (path) => {
      if (!live()) return undefined;
      if (!trust && !path.startsWith("plugins/")) return undefined;
      if (isSecretPath(path)) return undefined;
      return useIde.getState().files[path];
    },
    write: (path, content) => {
      if (!live()) return;
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
    open: (path) => {
      if (live()) useIde.getState().openFile(path);
    },
    active: () => (live() ? useIde.getState().activePath : null),
    format: async (path, code) => {
      if (!live()) return "";
      const result = await formatCode(path, code);
      return live() ? result : "";
    },
    output: (text, ok = true) => {
      if (!live()) return;
      useIde.getState().pushOutput({
        ok,
        stdout: ok ? text : "",
        stderr: ok ? "" : text,
        duration: 0,
        label: plugin,
      });
    },
    on: (event, fn) => {
      if (!live()) return;
      const off = onPlugin(event, (payload) => {
        if (live()) fn(payload);
      });
      unhooks.push(off);
      activation.rollback?.push(() => {
        off();
        const index = unhooks.indexOf(off);
        if (index >= 0) unhooks.splice(index, 1);
      });
    },
    status: (text) => {
      if (live()) useIde.getState().setPluginStatus(text);
    },
    prompt: (msg, fallback) =>
      live()
        ? typeof window !== "undefined"
          ? window.prompt(msg, fallback ?? "")
          : (fallback ?? null)
        : null,
    highlight: (code, lang) => (live() ? tokenize(code, lang || "plaintext") : []),
    cursor: () => (live() ? useIde.getState().cursor : { line: 1, col: 1 }),
    range: () => {
      if (!live()) return { from: 1, to: 1 };
      const s = useIde.getState().selection ?? {
        startLine: useIde.getState().cursor.line,
        endLine: useIde.getState().cursor.line,
        startCol: 1,
        endCol: 1,
      };
      return { from: Math.min(s.startLine, s.endLine), to: Math.max(s.startLine, s.endLine) };
    },
    insert: (text) => {
      if (!live()) return;
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
      if (!live() || !trust) return false;
      const cur = useIde.getState().files[path];
      if (cur == null || !old || !cur.includes(old)) return false;
      useIde.getState().writeFile(path, all ? cur.split(old).join(next) : cur.replace(old, next));
      return true;
    },
    grep: (query, glob) => {
      if (!live() || !trust) return [];
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
          if (ok && hits.length < 80)
            hits.push({ path, line: i + 1, text: line.trim().slice(0, 200) });
        });
      }
      return hits;
    },
    run: (path) => {
      if (!live()) return;
      if (!trust) {
        useIde.getState().setNotice("Plugin ohne @trust darf nicht starten");
        return;
      }
      if (path) useIde.getState().openFile(path);
      window.dispatchEvent(new Event("anvil-run"));
    },
    debug: () => {
      if (!live() || !trust) return;
      window.dispatchEvent(new Event("anvil-debug"));
    },
    fetch: async (url) => {
      if (!live()) return { ok: false, text: "Plugin nicht mehr aktiv" };
      if (!trust) return { ok: false, text: "Plugin ohne @trust darf nicht laden" };
      const result = await pluginFetch(url, live);
      return live() ? result : { ok: false, text: "Plugin nicht mehr aktiv" };
    },
    remove: (path) => {
      if (!live()) return;
      if (!trust) {
        useIde.getState().setNotice("Plugin ohne @trust darf nicht löschen");
        return;
      }
      if (isSecretPath(path)) return;
      useIde.getState().deleteFile(path);
    },
    mkdir: (path) => {
      if (!live() || !trust) return;
      useIde.getState().createFolder(path);
    },
    agent: (prompt) => {
      if (!live()) return;
      if (!trust) {
        useIde.getState().setNotice("Plugin ohne @trust darf den Agenten nicht starten");
        return;
      }
      useIde.getState().pushAgent(prompt);
    },
    complete: async (prompt) => {
      if (!live()) return "";
      if (!trust) {
        useIde.getState().setNotice("Plugin ohne @trust darf das Modell nicht nutzen");
        return "";
      }
      const s = useIde.getState();
      const result = await completeText({
        prompt,
        provider: s.llmProvider,
        baseUrl: s.llmBaseUrl,
        model: s.llmModel,
        apiKey: s.llmApiKey,
      });
      return live() ? result : "";
    },
    config: {
      get: (key, fallback) => {
        if (!live()) return fallback;
        const v = useIde.getState().pluginConfig[`${plugin}.${key}`];
        return v === undefined ? fallback : v;
      },
      set: (key, value) => {
        if (!live()) return;
        const st = useIde.getState();
        st.setPluginConfig({ ...st.pluginConfig, [`${plugin}.${key}`]: value });
      },
    },
    problems: (items) => {
      if (!live()) return;
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
        (code
          .split("\n")
          .slice(0, 8)
          .join("\n")
          .match(/@desc\s+(.+)/)?.[1]
          ?.trim() ||
          code
            .split("\n")
            .slice(0, 8)
            .join("\n")
            .match(/^\/\/\s*(.+)/)?.[1]
            ?.trim() ||
          "Workspace-Plugin"),
      builtin: false,
      category: "workspace",
      path,
      trustApi: trust,
    });
    if (!known.includes(id)) known = [...known, id];
    const consent = consents.get(id);
    if (consent && !sameConsent(consent, code)) {
      consents.delete(id);
      // A project switch revokes live handles, not that other project's saved grant.
      if (consent.epoch === st0.workspaceEpoch && consent.project === approvalProject(st0.workspaceCwd, st0.companionUrl)) revokeStoredApproval(consent.project, path);
    }
    if (!consents.has(id)) {
      if (!disabled.includes(id)) disabled = [...disabled, id];
      const expected = consentFor(code), pending = restoringConsent.get(id);
      if (!pending || !sameConsent(pending, code)) {
        restoringConsent.set(id, expected);
        void hasStoredApproval(expected.project, path, code).then(approved => {
          if (restoringConsent.get(id) !== expected) return;
          restoringConsent.delete(id);
          if (!approved || !sameConsent(expected, useIde.getState().files[path] ?? "")) return;
          consents.set(id, expected);
          const current = useIde.getState();
          current.setPluginDisabled(current.pluginDisabled.filter(value => value !== id));
          reloadPlugins();
        }).catch(() => { if (restoringConsent.get(id) === expected) restoringConsent.delete(id); });
      }
      continue;
    }
    if (disabled.includes(id) || !isPluginEnabled(id)) continue;
    try {
      const fn = new Function(
        "anvil",
        `${code}\n;if (typeof activate === "function") activate(anvil);`,
      );
      activatePlugin(id, trust, (api) => fn(api));
    } catch (err) {
      noticeErr(`Plugin ${path}`, err);
    }
  }
  const nextKnown = prunePluginIds(known, "ws:", live);
  const nextDisabled = prunePluginIds(disabled, "ws:", live);
  const st = useIde.getState();
  if (nextKnown.join("\0") !== st.pluginKnown.join("\0")) st.setPluginKnown(nextKnown);
  if (nextDisabled.join("\0") !== st.pluginDisabled.join("\0")) st.setPluginDisabled(nextDisabled);
  for (const id of consents.keys()) if (!live.includes(id)) { consents.delete(id); revokeStoredApproval(approvalProject(st.workspaceCwd, st.companionUrl), id.slice(3)); }
  for (const id of restoringConsent.keys()) if (!live.includes(id)) restoringConsent.delete(id);
}

/** Drop hooks, re-activate enabled builtins, then workspace plugins. One entry so file-change cannot leak `anvil.on`. */
export function reloadPlugins(files?: Record<string, string>) {
  if (reloading) return;
  reloading = true;
  apiGeneration++;
  try {
    for (const u of unhooks) u();
    unhooks.length = 0;
    clearPluginHooks();
    commands = [];
    extra.length = 0;
    for (const b of builtins) {
      if (!isPluginEnabled(b.id)) continue;
      try {
        activatePlugin(b.id, true, (api) => b.activate(api));
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
  return commands.filter((c) => isPluginEnabled(c.plugin));
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
// @trust — volle Helfer-API. Jede JavaScript-Datei braucht vollständiges Vertrauen.
// Anvil aktiviert dieses Plugin erst nach deiner ausdrücklichen Freigabe.
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
  Alle starten aus und brauchen ausdrückliche Freigabe pro Projekt, Inhalt und Rechten.
  JavaScript läuft im Renderer ohne Sandbox, mit Zugriff auf Desktop-Brücke und Netzwerk.
  Ohne @trust in den ersten 8 Zeilen sind nur die Helfer-APIs eingeschränkt.
  Mit // @trust: volle Helfer-API. Änderungen widerrufen die Freigabe.
VS Code: .vsix / plugins/*/package.json / .vscode/*.code-snippets
  — contributes.snippets, languages, Kommentare, tmLanguage-Keywords.
  Kein vscode-Modul, kein Language-Server.
`;
