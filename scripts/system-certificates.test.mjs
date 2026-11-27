import assert from "node:assert/strict";
import { test } from "node:test";
import { initializeSystemCertificates } from "../electron/system-certificates.mjs";

test("Windows HTTPS retains bundled/extra roots and includes system trust", () => {
  let installed;
  const originalTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  const result = initializeSystemCertificates({
    platform: "win32",
    api: {
      getCACertificates: (type) =>
        type === "default" ? ["bundled", "extra"] : ["windows-local-ca", "bundled"],
      setDefaultCACertificates: (certificates) => { installed = certificates; },
    },
  });
  assert.deepEqual(result, { status: "enabled", added: 1 });
  assert.deepEqual(installed, ["bundled", "extra", "windows-local-ca"]);
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, originalTlsSetting);
});

test("an empty Windows store never clears the existing HTTPS roots", () => {
  const result = initializeSystemCertificates({
    platform: "win32",
    api: {
      getCACertificates: (type) => type === "default" ? ["bundled", "extra"] : [],
      setDefaultCACertificates: () => assert.fail("existing roots must stay intact"),
    },
  });
  assert.deepEqual(result, { status: "unchanged", added: 0 });
});

test("already included system roots do not replace the active trust store", () => {
  assert.deepEqual(initializeSystemCertificates({
    platform: "win32",
    api: {
      getCACertificates: () => ["root"],
      setDefaultCACertificates: () => assert.fail("no additional trust to install"),
    },
  }), { status: "unchanged", added: 0 });
});

test("non-Windows hosts retain their configured certificate policy", () => {
  for (const platform of ["linux", "darwin"])
    assert.deepEqual(initializeSystemCertificates({
      platform,
      api: {
        getCACertificates: () => assert.fail("Windows trust must not be read"),
        setDefaultCACertificates: () => assert.fail("trust must not change"),
      },
    }), { status: "unchanged", added: 0 });
});

test("older runtimes keep normal TLS verification", () => {
  assert.deepEqual(initializeSystemCertificates({ platform: "win32", api: {} }), {
    status: "unsupported", added: 0,
  });
});

test("unavailable Windows trust reports the failure without disabling verification", () => {
  const result = initializeSystemCertificates({
    platform: "win32",
    api: {
      getCACertificates: (type) => {
        if (type === "system") throw new Error("Windows store unavailable");
        return ["bundled"];
      },
      setDefaultCACertificates: () => assert.fail("failed lookup cannot change trust"),
    },
  });
  assert.deepEqual(result, {
    status: "unavailable", added: 0, error: "Windows store unavailable",
  });
});
