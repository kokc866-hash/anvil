import "./builtins";
import "./extras";
export {
  activateBuiltins,
  loadWorkspacePlugins,
  listPlugins,
  listCommands,
  subscribePlugins,
  pluginSnapshot,
  PLUGIN_TEMPLATE,
  PLUGIN_API_DOC,
  type PluginCommand,
  type PluginInfo,
} from "./host";
export { loadVscodeFromWorkspace, importVsix, listVsPacks } from "./vscode";