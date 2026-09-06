import { findInFiles, applyHits, replaceInFiles, type SearchOpts, type SearchHit } from "./search";
self.onmessage = (event: MessageEvent<{ files: Record<string, string>; needle: string; opts: SearchOpts; replacement?: string; selected?: SearchHit[] }>) => {
  const { files, needle, opts, replacement, selected } = event.data;
  try {
    if (replacement !== undefined) {
      self.postMessage(selected ? { patched: applyHits(files, selected, needle, replacement, opts), total: selected.length } : replaceInFiles(files, needle, replacement, opts));
    } else {
      const hits = findInFiles(files, needle, opts, 201);
      self.postMessage({ hits: hits.slice(0, 200), more: hits.length > 200 });
    }
  } catch (e) { self.postMessage({ error: e instanceof Error ? e.message : String(e) }); }
};
