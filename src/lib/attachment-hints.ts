import { captureBrainCommit, captureBrainScope } from "./brain/scope";
import { brainAttach, brainReady, useBrain } from "./brain";
import { heuristicAttach } from "./brain/heuristics";

let cached: { text: string; pathsKey: string; paths: string[]; valid: () => boolean } | undefined;

/** Optional helper work runs while drafting, never between Send and the model request. */
export async function prepareAttachmentHints(text: string, pathsKey: string) {
  if (!text.trim() || !brainReady() || !useBrain.getState().jobs.attach) return;
  if (cached?.text === text && cached.pathsKey === pathsKey && cached.valid()) return;
  const valid = captureBrainCommit("attach");
  if (!valid()) return;
  try {
    const paths = await brainAttach(text, pathsKey.split("\n").filter(Boolean));
    if (valid()) cached = { text, pathsKey, paths, valid: captureBrainScope("attach") };
  } catch {
    /* Deterministic filename matching remains available. */
  }
}

export function attachmentHints(text: string, pathsKey: string): string[] {
  const paths = pathsKey.split("\n").filter(Boolean);
  const named = heuristicAttach(text, paths);
  const extra = cached?.text === text && cached.pathsKey === pathsKey && cached.valid() ? cached.paths : [];
  return [...new Set([...named, ...extra])].filter((path) => paths.includes(path)).slice(0, 4);
}
