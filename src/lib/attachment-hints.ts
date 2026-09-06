import { brainAttach, brainReady, useBrain } from "./brain";
import { heuristicAttach } from "./brain/heuristics";

let cached: { text: string; pathsKey: string; paths: string[] } | undefined;
let inFlight = false;

/** Optional helper work runs while drafting, never between Send and the model request. */
export async function prepareAttachmentHints(text: string, pathsKey: string) {
  if (inFlight || !text.trim() || !brainReady() || !useBrain.getState().jobs.attach) return;
  if (cached?.text === text && cached.pathsKey === pathsKey) return;
  inFlight = true;
  try {
    const paths = await brainAttach(text, pathsKey.split("\n").filter(Boolean));
    cached = { text, pathsKey, paths };
  } catch {
    /* Deterministic filename matching remains available. */
  } finally {
    inFlight = false;
  }
}

export function attachmentHints(text: string, pathsKey: string): string[] {
  const paths = pathsKey.split("\n").filter(Boolean);
  const named = heuristicAttach(text, paths);
  const extra = cached?.text === text && cached.pathsKey === pathsKey ? cached.paths : [];
  return [...new Set([...named, ...extra])].filter((path) => paths.includes(path)).slice(0, 4);
}
