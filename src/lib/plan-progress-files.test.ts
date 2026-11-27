import assert from "node:assert/strict";
import { test } from "node:test";
import { PlanProgress } from "./plan-progress.ts";
import { planDiskRequirements } from "./plan-targets.ts";
import type { WorkspaceFileProof } from "./workspace-file-proof.ts";

const realStep = "Speichere die Arbeitsdatei und rendere die beiden Ansichten als Roboter-im-Park.png und Stadtpark-Weit.png, jeweils in 1920 × 1080. Prüfe die erzeugten Dateien und halte in PRUEFUNG.md kurz fest, welche Sicht- und Dateiprüfungen belegt sind. Hake To-dos anhand der tatsächlichen Werkzeugergebnisse ab und nenne gegebenenfalls offene Punkte.";
const planStep = { text: realStep, status: "todo" as const };
const proof = (version = "1".repeat(64), width = 1920): WorkspaceFileProof => ({
  version, sha256: "a".repeat(64), size: 1024, width, height: 1080,
});
const asset = (plan: PlanProgress, path: string, file = proof()) =>
  plan.record("verify_file", { path }, { ok: true, path }, false, file)!;
const update = (plan: PlanProgress, evidence: string[]) =>
  plan.set({ updates: [{ step: 1, status: "ok", kind: "check", reason: "Verified the saved files and wrote the report.", evidence }] });

test("the saved robot-run checklist requires both exact PNG dimensions and the report write", () => {
  assert.deepEqual(planDiskRequirements(planStep), [
    { path: "Roboter-im-Park.png", width: 1920, height: 1080 },
    { path: "Stadtpark-Weit.png", width: 1920, height: 1080 },
  ]);
  const plan = new PlanProgress();
  plan.sync([planStep]);
  plan.setInputStamp("original-workspace");
  const mcp = plan.record("mcp_call", { server: "blender", name: "execute_blender_code" }, { ok: true })!;
  const html = plan.record("play", {}, { ok: true, functionalChecks: true })!;
  const report = plan.record("write_file", { path: "Ergebnis/PRUEFUNG.md" }, { ok: true }, true)!;
  assert.match(update(plan, [mcp, html, report]).error ?? "", /verify_file/);

  const robot = asset(plan, "Ergebnis/Stadtpark/Roboter-im-Park.png");
  const widePath = "Ergebnis/Stadtpark/Stadtpark-Weit.png";
  const mismatch = asset(plan, widePath, proof(undefined, 640));
  assert.match(update(plan, [robot, mismatch, report]).error ?? "", /verify_file/);
  const wide = asset(plan, widePath);
  assert.ok(update(plan, [robot, wide]).error, "both PNG receipts alone cannot stand in for writing the named report");
  plan.setInputStamp("reported-workspace");
  assert.equal(update(plan, [robot, wide, report]).ok, true, "an unrelated report write cannot stale file receipts");
  plan.setInputStamp("other-workspace-change");
  assert.equal(plan.plan[0].status, "ok");
});

test("an expressly named output folder excludes same-named files elsewhere", () => {
  const plan = new PlanProgress();
  plan.sync([{ text: "Prüfe Ergebnis/Stadtpark/Stadtpark-Weit.png auf 1920 x 1080", status: "todo" }]);
  const outside = asset(plan, "Ergebnis/Stadtpark-Weit.png");
  assert.match(update(plan, [outside]).error ?? "", /specified workspace-relative path/);
  const expected = asset(plan, "Ergebnis/Stadtpark/Stadtpark-Weit.png");
  assert.equal(update(plan, [expected]).ok, true);
});

test("version checking reopens stale saved-file proofs after resume, but leaves manual checks alone", async () => {
  const original = new PlanProgress();
  original.sync([{ text: "Prüfe Ergebnis/Ansicht.png auf 1920 x 1080", status: "todo" }]);
  const id = asset(original, "Ergebnis/Ansicht.png");
  assert.equal(update(original, [id]).ok, true);
  const restored = new PlanProgress();
  assert.equal(restored.restore(original.snapshot()), true);
  assert.equal(restored.plan[0].status, "ok");
  const paths: string[] = [];
  assert.equal(await restored.revalidateFiles(async query => {
    paths.push(query.path);
    assert.equal(query.versionOnly, true);
    return { ok: true, path: query.path, size: 1024, version: proof().version };
  }), false);
  assert.deepEqual(paths, ["Ergebnis/Ansicht.png"]);
  assert.equal(await restored.revalidateFiles(async query => ({ ok: false, path: query.path, error: "deleted" })), true);
  assert.equal(restored.plan[0].status, "todo");
  assert.match(update(restored, [id]).error ?? "", /failed|contradicted/);

  const manual = new PlanProgress();
  manual.sync([{ text: original.plan[0].text, status: "ok", completedBy: "user" }]);
  asset(manual, "Ergebnis/Ansicht.png");
  await manual.revalidateFiles(async () => ({ ok: false, error: "deleted" }));
  assert.equal(manual.plan[0].status, "ok");
});
