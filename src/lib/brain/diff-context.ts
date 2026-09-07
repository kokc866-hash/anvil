import { isSecretPath } from "../ref";
import { redactSecrets } from "../vault";

export type HelperDiff = { path: string; before: string; after: string };

/** Bounded excerpts of actual changes, never just filenames or byte counts. */
export function helperDiffContext(items: HelperDiff[]): string {
  return items.filter((i) => !isSecretPath(i.path) && i.before !== i.after).slice(0, 6).map((i) => {
    const before = i.before.split("\n");
    const after = i.after.split("\n");
    let start = 0;
    while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++;
    let endA = before.length, endB = after.length;
    while (endA > start && endB > start && before[endA - 1] === after[endB - 1]) { endA--; endB--; }
    const lines = [
      ...before.slice(start, Math.min(endA, start + 12)).map((l) => `- ${l}`),
      ...after.slice(start, Math.min(endB, start + 12)).map((l) => `+ ${l}`),
    ];
    return `${i.path}:${start + 1} (Auszug)\n${lines.join("\n").slice(0, 1000)}`;
  }).map((s) => redactSecrets(s).text).join("\n\n").slice(0, 5000);
}
