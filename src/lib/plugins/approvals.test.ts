import assert from "node:assert/strict";
import test from "node:test";
import { approvalProject, hasStoredApproval, PLUGIN_APPROVAL_KEY, revokeStoredApproval, storeApproval } from "./approvals.ts";

const memory = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};
test("consent is bound to project, exact contents, permissions and application policy", async () => {
  const store = memory(), a = approvalProject("I:\\ProjectA", "http://fixture.invalid")!, b = approvalProject("I:\\ProjectB", "http://fixture.invalid")!;
  const path = "plugins/a.js", code = "// @desc alpha\nfunction activate() {}";
  assert.equal(await hasStoredApproval(a, path, code, store), false);
  assert.equal(await storeApproval(a, path, code, store), true);
  assert.equal(await hasStoredApproval(a, path, code, store), true);
  assert.equal(await hasStoredApproval(b, path, code, store), false);
  assert.equal(await hasStoredApproval(a, "plugins/b.js", code, store), false);
  assert.equal(await hasStoredApproval(a, path, code.replace("alpha", "bravo"), store), false);
  assert.equal(await hasStoredApproval(a, path, code, store), false, "revocation remains in place after reverting an edit");
  await storeApproval(a, path, code, store);
  assert.equal(await hasStoredApproval(a, path, "// @trust\n" + code, store), false);
  await storeApproval(a, path, code, store);
  const records = JSON.parse(store.getItem(PLUGIN_APPROVAL_KEY)!);
  records[0].policy = "old-weaker-policy";
  store.setItem(PLUGIN_APPROVAL_KEY, JSON.stringify(records));
  assert.equal(await hasStoredApproval(a, path, code, store), false);
});
test("old plugin switches and project-file-shaped records are never consent", async () => {
  const store = memory(), project = approvalProject("I:/A", "http://fixture.invalid")!;
  store.setItem(PLUGIN_APPROVAL_KEY, JSON.stringify({ pluginKnown: ["ws:plugins/a.js"], pluginDisabled: [] }));
  assert.equal(await hasStoredApproval(project, "plugins/a.js", "// fixture", store), false);
  assert.equal(approvalProject("", "http://fixture.invalid"), null);
  assert.equal(await storeApproval(null, "plugins/a.js", "// fixture", store), false);
  assert.equal(approvalProject("I:\\A\\", "http://fixture.invalid/"), project);
});
test("separate projects retain approvals and explicit disabling is durable", async () => {
  const store = memory();
  await storeApproval("A", "plugins/a.js", "// fixture", store);
  await storeApproval("B", "plugins/a.js", "// fixture", store);
  revokeStoredApproval("A", "plugins/a.js", store);
  assert.equal(await hasStoredApproval("A", "plugins/a.js", "// fixture", store), false);
  assert.equal(await hasStoredApproval("B", "plugins/a.js", "// fixture", store), true);
  const denied = { getItem: (_key: string) => null, setItem: () => { throw new Error("quota fixture"); } };
  assert.equal(await storeApproval("A", "plugins/a.js", "// fixture", denied), false);
});
