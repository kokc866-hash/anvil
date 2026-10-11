import { parseSkillMd } from "./learn-parse.ts";

export type PluginFormat = "agent" | "codex" | "cursor";
export type PluginComponent = { kind: string; path: string; label: string; supported: boolean; detail: string };
export type AgentPluginPackage = {
  id: string; name: string; version?: string; description: string; license?: string;
  format: PluginFormat; manifest: string; files: Record<string, string>; skills: string[];
  components: PluginComponent[]; warnings: string[];
  servers: Array<{ name: string; url: string; auth?: "oauth" | "bearer" }>;
};

const PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
const encoder = new TextEncoder();
type Json = Record<string, unknown>;
type Candidate = { manifest: string; name: string; format: PluginFormat; root: string };
const object = (value: unknown): value is Json => value !== null && typeof value === "object" && !Array.isArray(value);

/** Portable, relative file paths only; validate before any package is written. */
export function normalizePluginPath(path: string): string {
  const value = path.replaceAll("\\", "/");
  if (!value || value.length > 1024 || value.split("/").some(part => !part || part.length > 255 || part === "." || part === ".."
    || /[<>:"|?*]/.test(part) || [...part].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || /[. ]$/.test(part)
    || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) {
    throw new Error("Ungültiger oder unter Windows mehrdeutiger Plugin-Pfad.");
  }
  return value;
}

function fileMap(input: Record<string, string>): Record<string, string> {
  if (!object(input)) throw new Error("Plugin-Dateien fehlen.");
  const entries = Object.entries(input);
  if (entries.length > 1000) throw new Error("Die Quelle enthält mehr als 1000 Dateien.");
  const seen = new Set<string>();
  let bytes = 0;
  const clean = entries.map(([raw, body]) => {
    const path = normalizePluginPath(raw), key = path.toLowerCase();
    if (typeof body !== "string") throw new Error("Plugin-Dateien müssen als Text oder Daten-URL vorliegen.");
    bytes += encoder.encode(body).length;
    if (bytes > 32 * 1024 * 1024) throw new Error("Die Quelle überschreitet 32 MiB.");
    if (seen.has(key)) throw new Error("Doppelte Plugin-Pfade unterscheiden sich nur in der Schreibweise.");
    seen.add(key);
    return [path, body] as const;
  });
  for (const path of seen) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) if (seen.has(parts.slice(0, i).join("/"))) throw new Error("Ein Plugin-Pfad ist zugleich Datei und Ordner.");
  }
  return Object.fromEntries(clean);
}

function json(source: string, path: string): Json {
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error(`Ungültiges JSON in ${path}.`); }
  if (!object(value)) throw new Error(`Ein JSON-Objekt wird in ${path} benötigt.`);
  return value;
}

function candidates(files: Record<string, string>): Candidate[] {
  const all: Candidate[] = [];
  for (const [path, source] of Object.entries(files)) {
    const match = path.match(/^(.*\/)?(?:(\.(codex|cursor)-plugin)\/)?plugin\.json$/);
    if (!match) continue;
    // Greedy prefixes need an explicit suffix check for the host manifests.
    const host = path.match(/^(.*\/)?\.(codex|cursor)-plugin\/plugin\.json$/);
    const root = host ? host[1] || "" : path.slice(0, -"plugin.json".length);
    if (!host && /(?:^|\/)\.[^/]+-plugin\/$/.test(root)) continue;
    const format: PluginFormat = host ? host[2] as PluginFormat : "agent";
    let name = root.replace(/\/$/, "").split("/").at(-1) || "Plugin";
    try { const parsed = JSON.parse(source) as Json; if (typeof parsed?.name === "string") name = parsed.name; } catch { /* Inspection reports invalid JSON. */ }
    all.push({ manifest: path, root, format, name });
  }
  return all.filter(item => item.format === "agent" || !all.some(other => other.format === "agent" && other.root === item.root));
}

export function discoverAgentPlugins(input: Record<string, string>): Array<{ manifest: string; name: string; format: PluginFormat }> {
  return candidates(fileMap(input)).map(({ manifest, name, format }) => ({ manifest, name, format }));
}

function componentPath(value: string): string {
  return normalizePluginPath(value.replace(/^\.\//, "").replace(/\/$/, ""));
}

function validateMetadata(meta: Json, format: PluginFormat): void {
  if (typeof meta.name !== "string" || meta.name.length > 64 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(meta.name)
    || (format === "agent" && /--|\.\./.test(meta.name))) throw new Error("Das Plugin benötigt einen gültigen Namen (maximal 64 kleine Buchstaben, Ziffern, Bindestriche oder Punkte).");
  if (format === "agent" && meta.$schema !== PLUGIN_SCHEMA) throw new Error("Das offene Plugin-Format benötigt die Schema-Version 1.0.0 in $schema.");
  for (const key of ["version", "description", "license", "homepage", "repository"]) {
    if (meta[key] !== undefined && typeof meta[key] !== "string") throw new Error(`Das Manifest-Feld ${key} muss Text enthalten.`);
  }
  if (meta.keywords !== undefined && (!Array.isArray(meta.keywords) || meta.keywords.some(item => typeof item !== "string"))) throw new Error("keywords muss eine Liste von Texten sein.");
  if (meta.author !== undefined && (!object(meta.author) || Object.values(meta.author).some(item => typeof item !== "string"))) throw new Error("author muss ein Objekt mit Textangaben sein.");
  if (meta.extensions !== undefined && (!object(meta.extensions) || Object.values(meta.extensions).some(item => !object(item)))) throw new Error("extensions muss benannte Objekte enthalten.");
}

/** Refuse embedded credentials rather than copying them into ordinary project files. */
function assertNoSecrets(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(assertNoSecrets); return; }
  if (!object(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && child.trim() && /^(?:authorization|proxy-authorization|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|token|.*_(?:TOKEN|API_KEY|SECRET|PASSWORD))$/i.test(key)
      && !/^(?:Bearer\s+|Basic\s+)?\$\{[a-zA-Z_][a-zA-Z0-9_]*\}$/.test(child.trim())) throw new Error("Das Paket enthält eingebettete Zugangsdaten. Zugangsdaten entfernen und den Dienst später in Anvil anmelden.");
    if (typeof child === "string" && /url|endpoint/i.test(key)) {
      try {
        const url = new URL(child);
        if (url.username || url.password || [...url.searchParams.keys()].some(name => /token|key|secret|password|auth/i.test(name))) throw new Error("secret-url");
      } catch (error) { if (error instanceof Error && error.message === "secret-url") throw new Error("Das Paket enthält eine Adresse mit Zugangsdaten. Eine öffentliche Dienstadresse verwenden."); }
    }
    assertNoSecrets(child);
  }
}

/** Pure inspection: preserves files, never runs scripts or contacts a service. */
export function inspectAgentPlugin(input: Record<string, string>, selectedManifest?: string): AgentPluginPackage {
  const source = fileMap(input), choices = candidates(source);
  if (!choices.length) throw new Error("Kein unterstütztes Plugin-Manifest gefunden (plugin.json, .codex-plugin/plugin.json oder .cursor-plugin/plugin.json).");
  const selected = selectedManifest && normalizePluginPath(selectedManifest);
  if (!selected && choices.length > 1) throw new Error("Mehrere Plugins gefunden. Bitte zuerst ein Plugin aus der Liste auswählen.");
  const choice = selected ? choices.find(item => item.manifest === selected) : choices[0];
  if (!choice) throw new Error("Das gewählte Manifest fehlt oder wird durch das kanonische plugin.json ersetzt.");
  const entries = Object.entries(source).filter(([path]) => path.startsWith(choice.root)).map(([path, body]) => [path.slice(choice.root.length), body] as const);
  if (entries.length > 300 || entries.reduce((sum, [, body]) => sum + encoder.encode(body).length, 0) > 16 * 1024 * 1024) throw new Error("Ein Plugin darf höchstens 300 Dateien und 16 MiB enthalten.");
  for (const [path, body] of entries) {
    if (path.split("/").some(part => /^(?:\.env(?:\..*)?|credentials(?:\.json)?|secrets\.(?:json|enc)|id_(?:rsa|ed25519)|\.npmrc|\.netrc)$/i.test(part))) throw new Error("Das Paket enthält eine lokale Datei mit möglichen Zugangsdaten. Bitte diese Datei aus dem Paket entfernen.");
    // Match the workspace's secret-path exclusions so imported files are never
    // silently lost on persistence/reopening (source code names stay allowed).
    const base = path.split("/").at(-1)!;
    if (/\.(pem|p12|pfx)$/i.test(base) || /(^|\/)(\.git-credentials|credentials)$/i.test(path)
      || (!/\.(md|ts|tsx|js|jsx|mjs|cjs|py|go|rs)$/i.test(base) && (/^(secrets?|password|token)(\.|$)/i.test(base) || /api[_-]?key/i.test(base) || /(^|\/)(secrets?|vault)(\.|\/|$)/i.test(path)))) throw new Error("Das Paket enthält eine von Anvil ausgeschlossene Zugangsdaten-Datei. Entferne diese vor dem Import.");
    if (/\.json$/i.test(path)) { try { assertNoSecrets(JSON.parse(body)); } catch (error) { if (!(error instanceof SyntaxError)) throw error; } }
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(body)) throw new Error("Private Schlüssel dürfen nicht in ein Plugin-Paket importiert werden.");
  }
  const files = Object.fromEntries(entries), manifest = choice.manifest.slice(choice.root.length), meta = json(files[manifest], manifest);
  validateMetadata(meta, choice.format);
  const result: AgentPluginPackage = {
    id: `${choice.format}-${[...encoder.encode(meta.name as string)].map(n => n.toString(16).padStart(2, "0")).join("")}`,
    name: meta.name as string, description: (meta.description as string) || "Keine Beschreibung im Paket.",
    version: meta.version as string | undefined, license: meta.license as string | undefined,
    format: choice.format, manifest, files, skills: [], components: [], warnings: [], servers: [],
  };
  const add = (kind: string, path: string, label: string, supported: boolean, detail: string) => result.components.push({ kind, path, label, supported, detail });
  const known = new Set(["$schema", "name", "description", "version", "author", "homepage", "repository", "license", "keywords", "extensions", ...(choice.format === "agent" ? [] : ["skills", "mcpServers", "rules", "agents", "commands", "hooks", "apps", "interface", "logo", "variables"])]);
  for (const key of Object.keys(meta)) if (!known.has(key)) result.warnings.push(`Unbekanntes Manifest-Feld „${key}“ bleibt gespeichert, wird aber nicht angewendet.`);
  if (object(meta.author) && Object.keys(meta.author).some(key => !["name", "email", "url"].includes(key))) result.warnings.push("Zusätzliche Angaben im author-Objekt werden nicht ausgewertet.");
  if (!result.license) result.warnings.push("Keine Lizenzangabe im Manifest. Nutzungs- und Weitergaberechte beim Anbieter prüfen.");
  if (choice.format === "agent") for (const overlay of [".codex-plugin/plugin.json", ".cursor-plugin/plugin.json"]) {
    if (files[overlay] !== undefined) add("overlay", overlay, "Zusätzliches Host-Manifest", false, "Das offene plugin.json ist maßgeblich. Host-spezifische Ergänzungen werden nicht aktiviert.");
  }
  if (meta.extensions !== undefined) add("extensions", manifest, "Host-spezifische Erweiterungen", false, "Die Erweiterungsdaten bleiben erhalten und werden nicht aktiviert.");
  if (meta.variables !== undefined) add("variables", manifest, "Konfigurationsvariablen", false, "Variablen werden nicht automatisch ersetzt. Betroffene Dienste müssen separat eingerichtet werden.");
  const explicitSkills = meta.skills === undefined || choice.format === "agent" ? [] : Array.isArray(meta.skills) ? meta.skills : [meta.skills];
  if (explicitSkills.some(item => typeof item !== "string")) throw new Error("skills muss einen relativen Pfad oder eine Liste relativer Pfade enthalten.");
  const roots = [...(choice.format === "cursor" && meta.skills !== undefined ? [] : ["skills"]), ...explicitSkills.map(item => componentPath(item as string))];
  const skillPaths = new Set<string>();
  for (const root of new Set(roots)) {
    const matches = Object.keys(files).filter(path => (path === root || path.startsWith(`${root}/`)) && /(?:^|\/)SKILL\.md$/.test(path));
    matches.forEach(path => skillPaths.add(path));
    if (!matches.length && explicitSkills.some(item => componentPath(item as string) === root)) add("skill", root, "Skill-Verzeichnis fehlt", false, "Der deklarierte Pfad enthält keine SKILL.md-Datei.");
  }
  if (choice.format === "cursor" && meta.skills === undefined && !Object.keys(files).some(path => path.startsWith("skills/")) && files["SKILL.md"] !== undefined) skillPaths.add("SKILL.md");
  const names = new Set<string>();
  for (const path of skillPaths) {
    const skill = parseSkillMd(files[path], path);
    const valid = Boolean(skill?.declaredName && skill.description && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name) && skill.name.length <= 64 && !names.has(skill.name));
    add("skill", path, skill?.name || path, valid, valid ? "Als Projekt-Skill importierbar. Werkzeuge und Skripte müssen zur jeweiligen Aufgabe passen." : "SKILL.md ist ungültig oder der Skill-Name kommt mehrfach vor. Name, Beschreibung und Anleitung prüfen.");
    if (valid) { result.skills.push(path); names.add(skill!.name); }
    else if (skill && names.has(skill.name)) {
      for (const previous of result.components) if (previous.kind === "skill" && previous.label === skill.name) {
        previous.supported = false;
        previous.detail = "Der Skill-Name kommt mehrfach vor. Vor der Aktivierung eindeutige Namen vergeben.";
        result.skills = result.skills.filter(item => item !== previous.path);
      }
    }
  }
  for (const kind of ["rules", "agents", "commands", "hooks", "apps"]) {
    const field = meta[kind];
    if (Array.isArray(field)) for (const item of field) if (typeof item === "string") componentPath(item);
    const found = Object.keys(files).filter(path => path.startsWith(`${kind}/`) || (kind === "apps" && path === ".app.json"));
    if (field !== undefined || found.length) add(kind, typeof field === "string" ? componentPath(field) : found[0] || manifest, kind, false, "Host-spezifischer Bestandteil; bleibt im Paket erhalten und wird nicht automatisch ausgeführt oder aktiviert.");
  }
  const mcpSources: Array<{ value: unknown; path: string; inline: boolean }> = [];
  const defaultMcp = choice.format === "codex" ? ".mcp.json" : "mcp.json";
  if ((choice.format !== "cursor" || meta.mcpServers === undefined) && files[defaultMcp] !== undefined) mcpSources.push({ value: json(files[defaultMcp], defaultMcp), path: defaultMcp, inline: false });
  if (choice.format !== "agent" && meta.mcpServers !== undefined) {
    for (const value of Array.isArray(meta.mcpServers) ? meta.mcpServers : [meta.mcpServers]) {
      if (typeof value === "string") {
        const path = componentPath(value);
        if (mcpSources.some(item => item.path === path)) continue;
        if (files[path] === undefined) add("mcp", path, "Dienstkonfiguration fehlt", false, "Die deklarierte MCP-Datei ist nicht im Paket enthalten.");
        else mcpSources.push({ value: json(files[path], path), path, inline: false });
      } else mcpSources.push({ value, path: manifest, inline: true });
    }
  }
  const serverNames = new Set<string>();
  for (const { value, path, inline } of mcpSources) {
    if (!object(value)) { add("mcp", path, "Ungültige Dienstkonfiguration", false, "MCP-Konfiguration muss ein Objekt enthalten."); continue; }
    if (choice.format === "agent" && value.$schema !== MCP_SCHEMA) { add("mcp", path, "Unbekanntes MCP-Schema", false, "Die offene MCP-Konfiguration benötigt Schema-Version 1.0.0."); continue; }
    const wrapped = Object.hasOwn(value, "mcpServers");
    const servers = wrapped ? value.mcpServers : inline ? value : undefined;
    if (!object(servers) || (wrapped && Object.keys(value).some(key => !["$schema", "mcpServers"].includes(key)))) { add("mcp", path, "Unbekannte Dienstkonfiguration", false, "Die Konfiguration enthält unbekannte Optionen oder keinen mcpServers-Abschnitt."); continue; }
    for (const [name, config] of Object.entries(servers)) {
      let reason = "";
      if (!object(config)) reason = "Die Serverdefinition ist kein Objekt.";
      else if (Object.keys(config).some(key => !["type", "url", "auth"].includes(key))) reason = "Zusätzliche Serveroptionen (etwa Header, lokale Befehle oder Umgebungsvariablen) benötigen eine manuelle Einrichtung.";
      else if (JSON.stringify(config).includes("${")) reason = "Die Serverdefinition verwendet nicht aufgelöste Variablen.";
      else if (choice.format === "agent" ? config.type !== "streamable-http" || config.auth !== undefined : config.type !== undefined && !["http", "streamable-http"].includes(String(config.type))) reason = "Dieser Transport oder diese Authentifizierungsoption wird beim Import nicht unterstützt.";
      else if (config.auth !== undefined && config.auth !== "oauth" && config.auth !== "bearer") reason = "Die Authentifizierung benötigt eine manuelle Einrichtung.";
      else if (typeof config.url !== "string") reason = "Eine HTTPS-Adresse fehlt.";
      else {
        try {
          const url = new URL(config.url);
          if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) reason = "Nur HTTPS-Adressen ohne Zugangsdaten, Abfrageparameter oder Fragment werden importiert.";
        } catch { reason = "Die Dienstadresse ist ungültig."; }
      }
      if (serverNames.has(name)) {
        reason = "Der Dienstname ist im Paket mehrfach definiert. Vor der Einrichtung eindeutige Namen vergeben.";
        result.servers = result.servers.filter(server => server.name !== name);
        for (const previous of result.components) if (previous.kind === "mcp" && previous.label === name) { previous.supported = false; previous.detail = reason; }
      }
      serverNames.add(name);
      add("mcp", path, name, !reason, reason || "Als deaktivierter Dienst importierbar. Anmeldung und Werkzeugfreigabe erfolgen anschließend in Anvil.");
      if (!reason && object(config)) result.servers.push({ name, url: config.url as string, ...(config.auth ? { auth: config.auth as "oauth" | "bearer" } : {}) });
    }
  }
  if (Object.keys(files).some(path => /(?:^|\/)scripts\//.test(path))) result.warnings.push("Beigefügte Skripte werden gespeichert, beim Import aber nicht ausgeführt.");
  return result;
}
