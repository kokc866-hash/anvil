import type { Checkpoint } from "@/store/ide-types";
import type { RestoreDiskPlan } from "./restore-plan";

export const CHECKPOINT_CONTENT_BUDGET = 96_000_000;
type Metadata = Omit<Checkpoint, "files" | "endFiles" | "restoreIntent" | "archiveMissing" | "archiveRevision">;
export type CheckpointRecord = {
  schema: 1;
  revision: string;
  checkpoint: Metadata;
  files: Record<string, string>;
  endFiles?: Record<string, string>;
  restoreIntent?: RestoreDiskPlan;
  unavailable?: boolean;
};
export type CheckpointArchive = { records: CheckpointRecord[]; contents: Map<string, string>; summaries: Checkpoint[] };
const prepared = new WeakMap<Checkpoint[], Promise<CheckpointArchive>>();

async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, "0")).join("");
}

/** Hash outside the IDB transaction. Immutable history is prepared once, never on each keystroke. */
export function prepareCheckpointArchive(checkpoints: Checkpoint[]): Promise<CheckpointArchive> {
  const existing = prepared.get(checkpoints);
  if (existing) return existing;
  const work = (async () => {
    const contents = new Map<string, string>(), hashes = new Map<string, Promise<string>>();
    let size = 0;
    const reference = async (text: string | null): Promise<string | null> => {
      if (text === null) return null;
      let hash = hashes.get(text);
      if (!hash) {
        size += text.length;
        if (size > CHECKPOINT_CONTENT_BUDGET) throw new Error("Die Sicherungspunkte überschreiten das Speicherbudget. Ältere Sicherungspunkte entfernen oder das Projekt separat sichern.");
        hash = digest(text);
        hashes.set(text, hash);
      }
      const key = await hash;
      contents.set(key, text);
      return key;
    };
    const refs = async (files: Record<string, string>) => Object.fromEntries(await Promise.all(
      Object.entries(files).map(async ([path, text]) => [path, await reference(text)] as const),
    )) as Record<string, string>;
    const records: CheckpointRecord[] = [];
    for (const checkpoint of checkpoints.slice(-40)) {
      const { files, endFiles, restoreIntent, archiveMissing, archiveRevision: _revision, ...metadata } = checkpoint;
      const record: CheckpointRecord = { schema: 1, revision: "", checkpoint: metadata, files: await refs(files),
        ...(endFiles ? { endFiles: await refs(endFiles) } : {}), ...(archiveMissing ? { unavailable: true } : {}) };
      if (restoreIntent) record.restoreIntent = { ...restoreIntent, files: await Promise.all(restoreIntent.files.map(async (entry) => ({
        ...entry, before: await reference(entry.before), after: await reference(entry.after), expected: await reference(entry.expected),
      }))) };
      record.revision = await digest(JSON.stringify(record));
      records.push(record);
    }
    return { records, contents, summaries: records.map((record) => ({ ...record.checkpoint, files: {}, archiveRevision: record.revision, archiveMissing: true })) };
  })();
  prepared.set(checkpoints, work);
  // A temporary failure must not poison all later saves of the same history.
  void work.catch(() => prepared.delete(checkpoints));
  return work;
}

export function checkpointReferences(record: CheckpointRecord): string[] {
  return [...Object.values(record.files), ...Object.values(record.endFiles ?? {}),
    ...(record.restoreIntent?.files.flatMap((f) => [f.before, f.after, f.expected].filter((x): x is string => x !== null)) ?? [])];
}

export function materializeCheckpoint(record: CheckpointRecord, contents: Map<string, string>): Checkpoint {
  let missing = Boolean(record.unavailable);
  const text = (reference: string | null) => {
    if (reference === null) return null;
    if (!contents.has(reference)) { missing = true; return ""; }
    return contents.get(reference)!;
  };
  const files = (refs: Record<string, string>) => Object.fromEntries(Object.entries(refs).map(([path, ref]) => [path, text(ref)!]));
  const checkpoint: Checkpoint = { ...record.checkpoint, files: files(record.files), archiveRevision: record.revision };
  if (record.endFiles) checkpoint.endFiles = files(record.endFiles);
  if (record.restoreIntent) checkpoint.restoreIntent = { ...record.restoreIntent, files: record.restoreIntent.files.map((f) => ({ ...f, before: text(f.before), after: text(f.after), expected: text(f.expected) })) };
  if (missing) checkpoint.archiveMissing = true;
  return checkpoint;
}
