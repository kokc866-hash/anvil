import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runRoot } from "./run-storage.mjs";

const active = new Set();
export const activeRunCount = () => active.size;
export const beginRun = (id) => active.add(id);
export const endRun = (id) => active.delete(id);
export function runStatus(id) {
  if (!/^[a-zA-Z0-9_-]+\/\d+-[a-f0-9]{12}$/.test(String(id))) throw new Error("Ungültige Run-ID");
  const file = path.join(runRoot(), id, "run.json");
  const record = JSON.parse(readFileSync(file, "utf8"));
  if (record.running && !active.has(id)) {
    record.ok = false;
    record.running = false;
    record.stderr = [record.stderr, "Companion wurde beendet; dieser Run ist nicht mehr aktiv."].filter(Boolean).join("\n");
    record.stage.kind = "log";
    writeFileSync(file, JSON.stringify(record, null, 2));
  }
  return record;
}
