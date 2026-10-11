import { useIde } from "@/store/ide";
import { hydrateLearnFromFiles } from "./learn";
import { captureDiskTarget, flushDiskSync, prepareRestoreDisk, syncRestore } from "./disk-sync";
import { flushPersistence } from "./persist-storage";
import { dropTestPaths } from "./test-parse";
import { agentPluginInstallFiles, importedAgentPlugins, pluginOwnedPaths, pluginRecord, pluginRoot } from "./agent-plugin-registry";
import { inspectAgentPlugin, type AgentPluginPackage } from "./agent-plugin-package";
import { ancestorDirs } from "./fs";

/** Commit to the captured disk target first; a failed save never announces installation. */
async function changePackage(changes: Record<string, string | null>, epoch: number, dependencies: string[] = []): Promise<void> {
  const before = useIde.getState();
  if (before.workspaceEpoch !== epoch || before.agentBusy || before.pathOperation) throw new Error("Das Projekt wurde gewechselt oder wird gerade bearbeitet. Versuche es danach erneut.");
  const target = captureDiskTarget(), lock = { from: "", to: "" };
  useIde.setState({ pathOperation: lock });
  try {
    await flushDiskSync();
    const same = () => {
      const current = useIde.getState(), now = captureDiskTarget();
      return current.workspaceEpoch === epoch && now.cwd === target.cwd && now.handle === target.handle && now.base === target.base && [...Object.keys(changes), ...dependencies].every(path => current.files[path] === before.files[path]);
    };
    if (!same()) throw new Error("Das Projekt wurde inzwischen geändert. Starte den Vorgang erneut.");
    const removed = new Set(Object.keys(changes).filter(path => changes[path] === null));
    const rmdir = [...new Set([...removed].flatMap(ancestorDirs))]
      .filter(dir => /^\.anvil\/skills\/package-[a-z0-9-]+(?:\/|$)/.test(dir) && !Object.keys(before.files).some(path => path.startsWith(dir + "/") && !removed.has(path)))
      .sort((a, b) => b.length - a.length);
    const removedDirs = await syncRestore(prepareRestoreDisk({ files: Object.entries(changes).map(([path, after]) => ({ path, before: before.files[path] ?? null, after })), mkdir: [], rmdir, conflicts: [] }, target), target);
    if (!same()) throw new Error("Die Paketdateien wurden im vorherigen Projekt gespeichert. Das aktuelle Projekt blieb unverändert; öffne das vorherige Projekt erneut.");
    const omit = <T>(values: Record<string, T>) => Object.fromEntries(Object.entries(values).filter(([path]) => !removed.has(path)));
    useIde.setState(state => {
      const files = { ...state.files }, dirty = { ...state.dirty }, editBases = { ...state.editBases };
      for (const [path, content] of Object.entries(changes)) {
        if (content === null) { delete files[path]; delete editBases[path]; } else { files[path] = content; editBases[path] = content; }
        delete dirty[path];
      }
      const openPaths = state.openPaths.filter(path => !removed.has(path));
      return { files, dirty, editBases, openPaths, dirs: state.dirs.filter(dir => !removedDirs.includes(dir)),
        activePath: state.activePath && removed.has(state.activePath) ? openPaths.at(-1) ?? null : state.activePath,
        undo: omit(state.undo), breakpoints: omit(state.breakpoints),
        attached: state.attached.filter(path => !removed.has(path)), recentPaths: state.recentPaths.filter(path => !removed.has(path)),
        pendingDiffs: state.pendingDiffs.filter(diff => !removed.has(diff.path)),
        testResults: dropTestPaths(state.testResults, path => removed.has(path)),
      };
    });
    hydrateLearnFromFiles(useIde.getState().files);
    await flushPersistence();
  } finally {
    if (useIde.getState().pathOperation === lock) useIde.setState({ pathOperation: null });
  }
}

export async function installAgentPlugin(pack: AgentPluginPackage, source: string, epoch: number) {
  const state = useIde.getState();
  const checked = inspectAgentPlugin(pack.files, pack.manifest);
  await changePackage(agentPluginInstallFiles(checked, source, state.files, state.dirs), epoch);
}

export async function enableAgentPlugin(id: string, enabled: boolean) {
  const state = useIde.getState(), record = importedAgentPlugins(state.files).find(pack => pack.id === id);
  if (!record) throw new Error("Das Plugin ist nicht mehr vorhanden.");
  if (enabled) {
    const root = pluginRoot(id) + "/";
    const source = Object.fromEntries(Object.entries(state.files).filter(([path]) => path.startsWith(root)).map(([path, body]) => [path.slice(root.length), body]));
    const checked = inspectAgentPlugin(source, record.manifest);
    if (checked.id !== id || JSON.stringify(checked.skills) !== JSON.stringify(record.skills) || JSON.stringify(checked.servers) !== JSON.stringify(record.servers)) throw new Error("Die Paketdefinition wurde verändert. Exportiere das Paket und importiere es nach dem Entfernen erneut, um die Änderungen zu prüfen.");
  }
  await changePackage({ [pluginRecord(id)]: JSON.stringify({ ...record, enabled }, null, 2) + "\n" }, state.workspaceEpoch, pluginOwnedPaths(state.files, id));
  if (enabled) hydrateLearnFromFiles(useIde.getState().files, record.skills.map(path => `.anvil/skills/package-${id}/${path}`));
}

export async function removeAgentPlugin(id: string, expected: Record<string, string>, epoch: number) {
  const current = useIde.getState().files, paths = pluginOwnedPaths(current, id);
  if (paths.length !== Object.keys(expected).length || paths.some(path => current[path] !== expected[path])) throw new Error("Das Plugin wurde inzwischen geändert. Prüfe es vor dem Entfernen erneut.");
  await changePackage(Object.fromEntries(paths.map(path => [path, null])), epoch);
}
