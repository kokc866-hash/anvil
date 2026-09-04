import assert from "node:assert/strict";
import { test } from "node:test";
import { machineFromOs, parseGpuInfo } from "./hw-parse.mjs";

test("machineFromOs reads cores and RAM", () => {
  const m = machineFromOs();
  assert.ok(m.cores >= 1);
  assert.ok(m.ramGb >= 0.5);
  assert.ok(m.freeGb >= 0);
  assert.ok(m.arch);
});

test("parseGpuInfo picks active NVIDIA", () => {
  const p = parseGpuInfo({
    gpuDevice: [
      { vendorId: 32902, deviceString: "Intel UHD", vendorString: "Intel", active: false },
      { vendorId: 4318, deviceString: "NVIDIA GeForce RTX 4070", vendorString: "NVIDIA", active: true },
    ],
  });
  assert.equal(p.vendor, "NVIDIA");
  assert.match(p.gpu, /4070/);
});

test("parseGpuInfo maps vendorId and strips ANGLE", () => {
  const p = parseGpuInfo({
    gpuDevice: [{ vendorId: 4098, active: true }],
    auxAttributes: { glRenderer: "ANGLE (AMD Radeon RX 7800 XT)" },
  });
  assert.equal(p.vendor, "AMD");
  assert.match(p.gpu, /7800/);
});
