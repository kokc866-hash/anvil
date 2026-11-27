export const TRAIL_SPLIT_GAP = 12;

/** Fit the preferred thinking height inside the real space above the to-do. */
export function fitTrailSplit(available: number, preferred: number) {
  const height = Number.isFinite(available) ? Math.max(0, Math.floor(available)) : 0;
  const gap = Math.min(TRAIL_SPLIT_GAP, height);
  const usable = height - gap;
  // Keep a readable execution region. In a very short pane, tools take priority.
  const minTools = Math.min(usable, Math.max(96, Math.min(200, Math.floor(usable * 0.4))));
  const maxThinking = usable - minTools;
  const requested = Number.isFinite(preferred) ? Math.max(72, Math.round(preferred)) : 200;
  const thinking = Math.min(maxThinking, requested);
  return { thinking, tools: usable - thinking, minTools, maxThinking, gap };
}
