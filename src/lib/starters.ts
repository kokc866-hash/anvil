import { useIde } from "@/store/ide";
import { SEED_FILES } from "./seed-files";
import { starterOf, mergeStarter, type StarterId } from "./starters-core";

export type { StarterId, Starter } from "./starters-core";
export { STARTERS, starterOf, isBareWorkspace, mergeStarter } from "./starters-core";

export function applyStarter(id: StarterId, replace = false): string {
  const st = useIde.getState();
  const pack = mergeStarter(st.files, id, replace, SEED_FILES);
  st.applyFiles(pack);
  const main = starterOf(id).main;
  st.openFile(main);
  return main;
}