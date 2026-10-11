import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useIde } from "@/store/ide";
import { discoverAgentPlugins, inspectAgentPlugin, type AgentPluginPackage } from "@/lib/agent-plugin-package";
import { pluginFileContent, readPluginZip, PLUGIN_ARCHIVE_BYTES, PLUGIN_ARCHIVE_FILES } from "@/lib/agent-plugin-archive";
import { importedAgentPlugins, pluginOwnedPaths, pluginRoot, type ImportedAgentPlugin } from "@/lib/agent-plugin-registry";
import { installAgentPlugin, enableAgentPlugin, removeAgentPlugin } from "@/lib/agent-plugin-install";
import { createService } from "@/lib/mcp-services";
import { confirmApp } from "@/lib/confirm";
import { flushPersistence } from "@/lib/persist-storage";
import { skillPackageZip } from "@/lib/skill-package";
import { downloadBlob } from "@/lib/archive";

const action = "h-auto min-h-9 max-w-full whitespace-normal px-2 py-1.5 text-xs";
const formatName = { agent: "Agent Plugins", codex: "Codex", cursor: "Cursor" };

export function AgentPluginPackages({ query = "", onServices }: { query?: string; onServices: () => void }) {
  const files = useIde(state => state.files), epoch = useIde(state => state.workspaceEpoch);
  const blocked = useIde(state => state.agentBusy || Boolean(state.pathOperation));
  const en = useIde(state => state.locale === "en");
  const label = (de: string, english: string) => en ? english : de;
  const folderInput = useRef<HTMLInputElement>(null), zipInput = useRef<HTMLInputElement>(null), sequence = useRef(0);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState<{ files: Record<string, string>; source: string; epoch: number }>();
  const [choices, setChoices] = useState<ReturnType<typeof discoverAgentPlugins>>([]);
  const [preview, setPreview] = useState<AgentPluginPackage>();
  const [selectedManifest, setSelectedManifest] = useState("");
  const installed = importedAgentPlugins(files).filter(pack => `${pack.name} ${pack.description} ${pack.format}`.toLowerCase().includes(query.toLowerCase()));
  const currentPreview = loaded?.epoch === epoch ? preview : undefined;

  async function perform(job: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await job(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function load(selected: File[], zip: boolean) {
    const request = ++sequence.current, startEpoch = useIde.getState().workspaceEpoch;
    setPreview(undefined); setChoices([]); setLoaded(undefined); setSelectedManifest("");
    await perform(async () => {
      if (selected.length > PLUGIN_ARCHIVE_FILES || selected.reduce((sum, file) => sum + file.size, 0) > PLUGIN_ARCHIVE_BYTES) throw new Error(label("Wähle einen Plugin-Ordner mit höchstens 1.000 Dateien und 32 MB.", "Choose a plugin folder with at most 1,000 files and 32 MB."));
      const input: Record<string, string> = Object.create(null);
      if (zip) Object.assign(input, await readPluginZip(await selected[0].arrayBuffer()));
      else for (const file of selected) {
        const path = file.webkitRelativePath || file.name;
        if (Object.hasOwn(input, path)) throw new Error(`Duplicate: ${path}`);
        input[path] = pluginFileContent(new Uint8Array(await file.arrayBuffer()));
      }
      const candidates = discoverAgentPlugins(input);
      if (request !== sequence.current || startEpoch !== useIde.getState().workspaceEpoch) throw new Error(label("Das Projekt wurde gewechselt. Wähle das Paket im aktuellen Projekt erneut.", "The project changed. Select the package again in the current project."));
      const source = zip ? selected[0].name : (selected[0].webkitRelativePath.split("/")[0] || "Ordner");
      setLoaded({ files: input, source, epoch: startEpoch }); setChoices(candidates);
      if (candidates.length === 1) setPreview(inspectAgentPlugin(input, candidates[0].manifest));
      if (!candidates.length) throw new Error(label("Kein unterstütztes Plugin-Manifest gefunden. Wähle ein Agent-, Codex- oder Cursor-Paket.", "No supported plugin manifest found. Choose an Agent, Codex or Cursor package."));
    });
    if (folderInput.current) folderInput.current.value = "";
    if (zipInput.current) zipInput.current.value = "";
  }

  async function prepareServices(pack: ImportedAgentPlugin) {
    const state = useIde.getState();
    if (state.agentBusy || state.pathOperation) throw new Error(label("Warte, bis die laufende Arbeit abgeschlossen ist.", "Wait until the current work is finished."));
    // Revalidate files: the saved record alone is not permission to contact an endpoint.
    const root = pluginRoot(pack.id) + "/";
    const checked = inspectAgentPlugin(Object.fromEntries(Object.entries(state.files).filter(([path]) => path.startsWith(root)).map(([path, body]) => [path.slice(root.length), body])), pack.manifest);
    const servers = [...state.mcpServers];
    let generic = false;
    for (const entry of checked.servers) {
      const auth = entry.auth || "oauth";
      if (auth === "bearer") generic = true;
      if (servers.some(server => server.url === entry.url && server.transport !== "stdio" && server.auth === auth)) continue;
      servers.push(auth === "oauth" ? createService("custom", `${pack.name} · ${entry.name}`, entry.url) : {
        id: `plugin-mcp:${crypto.randomUUID()}`, name: `${pack.name} · ${entry.name}`, url: entry.url, transport: "http", auth: "bearer", enabled: false,
      });
    }
    state.setMcpServers(servers);
    await flushPersistence();
    if (generic) state.setSidebar("mcp"); else onServices();
  }

  return <section className="min-w-0 space-y-3 border-b border-border pb-4" data-testid="agent-plugin-packages">
    <div><h3 className="text-sm font-semibold">{label("Agenten-Plugins", "Agent plugins")}</h3><p className="mt-1 text-xs text-muted">{label("Skills und Werkzeuge aus offenen Agent-, Codex- und Cursor-Paketen. Prüfe die unterstützten Teile vor dem Import.", "Skills and tools from open Agent, Codex and Cursor packages. Review supported components before importing.")}</p></div>
    <div className="flex flex-wrap gap-2"><Button className={action} disabled={busy || blocked} onClick={() => folderInput.current?.click()}>{label("Plugin-Ordner prüfen", "Inspect plugin folder")}</Button><Button className={action} disabled={busy || blocked} onClick={() => zipInput.current?.click()}>{label("Plugin-ZIP prüfen", "Inspect plugin ZIP")}</Button></div>
    <input ref={folderInput} type="file" multiple className="hidden" aria-label="Plugin folder" {...{ webkitdirectory: "" }} onChange={event => { const list = Array.from(event.target.files || []); if (list.length) void load(list, false); }} />
    <input ref={zipInput} type="file" accept=".zip,application/zip" className="hidden" aria-label="Plugin ZIP" onChange={event => { const list = Array.from(event.target.files || []); if (list.length) void load(list, true); }} />
    <p className="text-[11px] text-muted">{label("Auch ZIP-Downloads aus Git-Repositories sind möglich. Der Import startet keine Skripte, installiert keine Laufzeiten und übernimmt keine fremden Anmeldungen.", "ZIP downloads from Git repositories are supported. Importing does not run scripts, install runtimes or copy existing sign-ins.")}</p>
    {choices.length > 1 && loaded?.epoch === epoch && <label className="block text-xs">{label("Paket im Archiv auswählen", "Choose a package in the archive")}<select className="mt-1 w-full min-w-0 rounded border border-border bg-bg p-2" value={selectedManifest} onChange={event => {
      setSelectedManifest(event.target.value); setPreview(undefined); setMessage("");
      if (event.target.value && loaded) try { setPreview(inspectAgentPlugin(loaded.files, event.target.value)); } catch (error) { setMessage(String(error)); }
    }}><option value="">{label("Paket wählen…", "Select package…")}</option>{choices.map(choice => <option key={choice.manifest} value={choice.manifest}>{choice.name} · {choice.manifest}</option>)}</select></label>}
    {currentPreview && <div className="space-y-2 rounded border border-border p-3" data-testid="plugin-preview">
      <h4 className="break-words text-sm font-semibold">{currentPreview.name} {currentPreview.version && <span className="text-muted">{currentPreview.version}</span>}</h4>
      <p className="text-xs text-muted">{formatName[currentPreview.format]} · {label("Lizenzangabe", "Declared license")}: {currentPreview.license || label("nicht angegeben", "not provided")}</p>
      <p className="break-words text-xs">{currentPreview.description}</p>
      <p className="text-xs">{currentPreview.skills.length} Skills · {currentPreview.servers.length} {label("vorbereitbare Dienste", "configurable services")}</p>
      <ul className="space-y-2 text-xs">{currentPreview.components.map((part, index) => <li key={index} className="break-words"><strong>{part.label}</strong> — {part.supported ? label("importierbar", "importable") : label("noch nicht unterstützt", "not yet supported")}<p className="text-muted">{part.detail}</p></li>)}</ul>
      {currentPreview.warnings.map((warning, index) => <p key={index} className="break-words text-xs text-muted">{warning}</p>)}
      <p className="text-[11px] text-muted">{label("Die Prüfung bestätigt das Paketformat, nicht die Qualität oder Funktion beim Anbieter. Unbekannte Zusatzfunktionen werden nicht aktiviert. Anleitungen können Skripte oder externe Dienste voraussetzen.", "This checks the package format, not quality or provider functionality. Unknown features are not activated. Instructions may require scripts or external services.")}</p>
      <div className="flex flex-wrap gap-2"><Button className={action} variant="primary" disabled={busy || blocked || !(currentPreview.skills.length || currentPreview.servers.length)} onClick={() => void perform(async () => {
        await installAgentPlugin(currentPreview, loaded!.source, loaded!.epoch);
        setPreview(undefined); setChoices([]); setLoaded(undefined);
        setMessage(label("Plugin importiert und gespeichert. Aktiviere die Skills oder richte die Dienste ein, wenn du sie verwenden möchtest.", "Plugin imported and saved. Enable its skills or configure its services to use them."));
      })}>{label("Unterstützte Teile importieren", "Import supported components")}</Button><Button className={action} disabled={busy} onClick={() => { setPreview(undefined); setChoices([]); setLoaded(undefined); }}>{label("Verwerfen", "Discard")}</Button></div>
    </div>}
    {installed.map(pack => <article key={pack.id} className="space-y-2 rounded border border-border p-3" data-testid="imported-plugin">
      <h4 className="break-words text-sm font-semibold">{pack.name} {pack.version || ""}</h4>
      <p className="text-xs text-muted">{formatName[pack.format]} · {pack.skills.length ? pack.enabled ? label("Skills aktiviert", "Skills enabled") : label("Skills deaktiviert", "Skills disabled") : label("Dienstpaket", "Service package")}</p>
      <p className="break-words text-xs text-muted">{pack.description}</p>
      {pack.components.some(component => !component.supported) && <p className="text-xs text-muted">{label("Teilweise unterstützt. Details zeigen die fehlenden Funktionen.", "Partially supported. Details list unavailable features.")}</p>}
      <div className="flex flex-wrap gap-2">
        {pack.skills.length > 0 && <Button className={action} disabled={busy || blocked} onClick={() => void perform(async () => { await enableAgentPlugin(pack.id, !pack.enabled); })}>{pack.enabled ? label("Skills deaktivieren", "Disable skills") : label("Skills aktivieren", "Enable skills")}</Button>}
        {pack.servers.length > 0 && <Button className={action} disabled={busy || blocked} onClick={() => void perform(() => prepareServices(pack))}>{label("Dienste einrichten", "Configure services")}</Button>}
        {pack.enabled && pack.skills.length > 0 && <Button className={action} disabled={busy || blocked} onClick={() => {
          const state = useIde.getState();
          const addition = label(`Verwende die passenden Skills aus dem Plugin „${pack.name}“. Lies zuerst die zugehörige SKILL.md und prüfe deren Voraussetzungen:`, `Use the relevant skills from plugin “${pack.name}”. Read the relevant SKILL.md and check its prerequisites first:`) + "\n" + pack.skills.map(path => `${pluginRoot(pack.id)}/${path}`).join("\n");
          if (!state.agentDraft.includes(addition)) state.setAgentDraft([state.agentDraft, addition].filter(Boolean).join("\n\n"));
          setMessage(label("Zum Chat-Entwurf hinzugefügt. Ergänze deinen Auftrag und sende ihn, wenn du bereit bist.", "Added to your chat draft. Add your task and send it when ready."));
        }}>{label("Im Chat verwenden", "Use in chat")}</Button>}
        <Button className={action} disabled={busy || blocked} onClick={() => void perform(async () => {
          const before = useIde.getState(), owned = Object.fromEntries(pluginOwnedPaths(before.files, pack.id).map(path => [path, before.files[path]]));
          if (!await confirmApp(label(`„${pack.name}“ mit ${Object.keys(owned).length} Paketdateien entfernen? Änderungen innerhalb des Pakets werden ebenfalls entfernt. Deine übrigen Projektdateien und separat eingerichtete Dienstverbindungen bleiben erhalten.`, `Remove “${pack.name}” and ${Object.keys(owned).length} package files? Edits inside this package are also removed. Other project files and separately configured service connections are kept.`), { title: label("Plugin entfernen", "Remove plugin"), ok: label("Entfernen", "Remove"), danger: true })) return;
          await removeAgentPlugin(pack.id, owned, before.workspaceEpoch);
          setMessage(label("Plugin und seine Skills entfernt. Separat eingerichtete Verbindungen verwaltest du unter Dienste oder MCP.", "Plugin and its skills removed. Manage separate connections under Services or MCP."));
        })}>{label("Entfernen", "Remove")}</Button>
      </div>
      <details className="text-xs"><summary className="cursor-pointer text-muted">{label("Inhalt und Herkunft", "Contents and source")}</summary><div className="mt-2 space-y-2 break-words"><p>{label("Importiert aus", "Imported from")}: {pack.source}</p><p>{label("Lizenzangabe", "Declared license")}: {pack.license || label("nicht angegeben", "not provided")}</p>{pack.components.map((part, index) => <p key={index}>{part.label}: {part.detail}</p>)}{pack.warnings.map((warning, index) => <p key={index}>{warning}</p>)}<Button className={action} disabled={busy} onClick={() => void perform(async () => {
        const root = pluginRoot(pack.id) + "/";
        const contents = Object.fromEntries(Object.entries(useIde.getState().files).filter(([path]) => path.startsWith(root)).map(([path, body]) => [path.slice(root.length), body]));
        const bytes = skillPackageZip(contents);
        downloadBlob(new Blob([bytes as BlobPart], { type: "application/zip" }), `${pack.name}.zip`);
      })}>{label("Paket exportieren", "Export package")}</Button></div></details>
    </article>)}
    {message && <p role="status" className="break-words text-xs">{message}</p>}
  </section>;
}
