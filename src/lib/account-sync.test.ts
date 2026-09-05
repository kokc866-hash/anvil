import assert from "node:assert/strict";
import { test } from "node:test";
import { GIST_DESC, makePack, parsePack } from "./account-sync.ts";

test("makePack is v1 with settings", () => {
  const p = makePack({ theme: "dark" });
  assert.equal(p.v, 1);
  assert.equal(p.settings.theme, "dark");
  assert.ok(p.at > 0);
});

test("parsePack rejects junk", () => {
  assert.throws(() => parsePack(null));
  assert.throws(() => parsePack({ v: 2, settings: {} }));
  assert.throws(() => parsePack({ v: 1 }));
});

test("parsePack round-trips makePack", () => {
  const p = makePack({ locale: "de" });
  const back = parsePack(JSON.parse(JSON.stringify(p)));
  assert.equal(back.v, 1);
  assert.equal(back.settings.locale, "de");
});

test("gist description is stable", () => {
  assert.equal(GIST_DESC, "anvil-settings");
});
