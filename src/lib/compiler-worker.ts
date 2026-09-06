import { disposeTs, ensureTs, tscWorkspace, tsChecked, tsQuickInfoSync, tsDefinitionSync, tsRename } from "./compiler-engine";
import { lintWorkspace } from "./lsp-lint";
let files: Record<string, string> = {};
let jobs: Promise<unknown> = Promise.resolve();
let latestLint = 0;
self.onmessage = ({ data }) => {
  const { id, method, args, changes, reset, open } = data;
  files = reset ? {} : { ...files };
  for (const [p, c] of Object.entries(changes)) { if (c === null) delete files[p]; else if (typeof c === "string") files[p] = c; }
  const snapshot = files;
  if (method === "lint") latestLint = id;
  jobs = jobs.catch(() => undefined).then(async () => {
    try {
      if (reset) disposeTs();
      if (method === "lint" && latestLint !== id) { self.postMessage({ id, error: "Überholte Diagnose" }); return; }
      await ensureTs(snapshot, open);
      if (method === "lint") self.postMessage({ id, hits: await tscWorkspace(snapshot, open), local: lintWorkspace(snapshot, open), checked: tsChecked() });
      else if (method === "hover") self.postMessage({ id, value: tsQuickInfoSync(args.path, args.offset) });
      else if (method === "definition") self.postMessage({ id, value: tsDefinitionSync(args.path, args.offset) });
      else if (method === "rename") self.postMessage({ id, value: await tsRename(snapshot, args.path, args.offset, args.nextName, open) });
    } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
  });
};
