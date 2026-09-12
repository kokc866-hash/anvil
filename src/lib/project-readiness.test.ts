import assert from "node:assert/strict";
import { test } from "node:test";
import { projectReadiness } from "./project-readiness.ts";

test("a simple HTML example requires neither Node nor model authentication", () => {
  const rows = projectReadiness({ files: { "web-paket/index.html": "<html>Example</html>" }, saved: true, model: "" });
  assert.equal(rows.find(row => row.id === "runtime")?.status, "ready");
  assert.equal(rows.find(row => row.id === "model")?.status, "optional");
  assert.match(rows.find(row => row.id === "entry")!.detail, /noch nicht geprüft/);
});

test("unknown runtime cannot be confused with a missing or verified runtime", () => {
  const project = { files: { "package.json": "{}" }, saved: false, model: "selected-only" };
  assert.equal(projectReadiness(project).find(row => row.id === "runtime")?.status, "unknown");
  assert.equal(projectReadiness({ ...project, bins: { node: null } }).find(row => row.id === "runtime")?.status, "missing");
  assert.equal(projectReadiness({ ...project, bins: { node: "node.exe" } }).find(row => row.id === "runtime")?.status, "ready");
  assert.match(projectReadiness(project).find(row => row.id === "model")!.detail, /erfolgreiche Antwort sind hier nicht geprüft/);
});
