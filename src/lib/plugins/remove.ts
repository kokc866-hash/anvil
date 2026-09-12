import { useIde } from "@/store/ide";
import { confirmApp } from "../confirm";
import { captureDiskTarget, flushDiskSync, prepareRestoreDisk, syncRestore } from "../disk-sync";
import { flushPersistence } from "../persist-storage";
import { dropTestPaths } from "../test-parse";
import { reloadPlugins } from "./host";
import { isWorkspacePluginPath } from "./util";

/** Delete the checked file on disk before forgetting its editor/runtime state. */
export async function removeWorkspacePlugin(path: string, expected: string): Promise<boolean> {
  const before = useIde.getState(),
    en = before.locale === "en";
  if (
    !isWorkspacePluginPath(path) ||
    before.files[path] !== expected ||
    before.agentBusy ||
    before.pathOperation
  ) {
    before.setNotice(
      en
        ? "Plugin changed or project is busy. Try again."
        : "Plugin inzwischen geändert oder Projekt beschäftigt. Erneut versuchen.",
    );
    return false;
  }
  const target = captureDiskTarget(),
    lock = { from: "", to: "" };
  useIde.setState({ pathOperation: lock });
  try {
    await flushDiskSync();
    const current = useIde.getState();
    if (current.workspaceEpoch !== before.workspaceEpoch || current.files[path] !== expected)
      throw new Error(en ? "Project changed." : "Projekt inzwischen geändert.");
    const plan = prepareRestoreDisk(
      { files: [{ path, before: expected, after: null }], mkdir: [], rmdir: [], conflicts: [] },
      target,
    );
    await syncRestore(plan, target);
    const afterDisk = useIde.getState(),
      nowTarget = captureDiskTarget();
    if (
      afterDisk.workspaceEpoch !== before.workspaceEpoch ||
      nowTarget.cwd !== target.cwd ||
      nowTarget.handle !== target.handle ||
      nowTarget.base !== target.base ||
      afterDisk.files[path] !== expected
    ) {
      afterDisk.setNotice(
        en
          ? "Plugin removed from the previous project. The current project was left unchanged."
          : "Plugin im vorherigen Projekt entfernt. Das aktuelle Projekt blieb unverändert.",
      );
      return false;
    }
    const id = `ws:${path}`;
    const otherOwners = Object.keys(afterDisk.files)
      .filter((p) => p !== path && isWorkspacePluginPath(p))
      .map((p) => `ws:${p}`);
    const omit = <T>(items: Record<string, T>) =>
      Object.fromEntries(Object.entries(items).filter(([key]) => key !== path));
    useIde.setState((s) => {
      const openPaths = s.openPaths.filter((p) => p !== path);
      return {
        files: omit(s.files),
        dirty: omit(s.dirty),
        editBases: omit(s.editBases),
        undo: omit(s.undo),
        breakpoints: omit(s.breakpoints),
        openPaths,
        activePath: s.activePath === path ? (openPaths.at(-1) ?? null) : s.activePath,
        attached: s.attached.filter((p) => p !== path),
        recentPaths: s.recentPaths.filter((p) => p !== path),
        pendingDiffs: s.pendingDiffs.filter((d) => d.path !== path),
        testResults: dropTestPaths(s.testResults, (p) => p === path),
        pluginKnown: s.pluginKnown.filter((p) => p !== id),
        pluginDisabled: s.pluginDisabled.filter((p) => p !== id),
        pluginConfig: Object.fromEntries(
          Object.entries(s.pluginConfig).filter(
            ([key]) =>
              !key.startsWith(`${id}.`) || otherOwners.some((owner) => key.startsWith(`${owner}.`)),
          ),
        ),
        pluginProblems: s.pluginProblems.filter((p) => p.source !== id),
        pluginStatus: "",
      };
    });
    reloadPlugins();
    await flushPersistence();
    useIde.getState().setNotice(en ? `Removed: ${path}` : `Entfernt: ${path}`);
    return true;
  } catch (error) {
    useIde
      .getState()
      .setNotice(
        `${en ? "Removal not fully saved" : "Entfernen nicht vollständig gespeichert"}: ${error instanceof Error ? error.message : String(error)}`,
      );
    return false;
  } finally {
    if (useIde.getState().pathOperation === lock) useIde.setState({ pathOperation: null });
  }
}

export async function requestRemoveWorkspacePlugin(path: string): Promise<boolean> {
  const before = useIde.getState(),
    expected = before.files[path],
    en = before.locale === "en";
  if (!isWorkspacePluginPath(path) || expected === undefined) return false;
  const body = `${path}\n\n${en ? "The plugin file and its settings will be removed from this project. Unsaved changes in this file will also be removed." : "Die Plugin-Datei und ihre Einstellungen werden aus diesem Projekt entfernt. Auch ungespeicherte Änderungen dieser Datei werden entfernt."}`;
  if (
    !(await confirmApp(body, {
      title: en ? "Remove plugin" : "Plugin entfernen",
      ok: en ? "Remove plugin" : "Plugin entfernen",
      danger: true,
    }))
  )
    return false;
  if (before.workspaceEpoch !== useIde.getState().workspaceEpoch) return false;
  return removeWorkspacePlugin(path, expected);
}
