/** Machine facts without Electron — testable. */
import os from "node:os";

const VENDORS = {
  4318: "NVIDIA",
  4098: "AMD",
  32902: "Intel",
  4203: "Apple",
};

export function parseGpuInfo(info) {
  const devices = Array.isArray(info?.gpuDevice) ? info.gpuDevice : [];
  const active = devices.find((d) => d.active) || devices[0] || {};
  const vid = Number(active.vendorId || 0);
  let vendor = String(active.vendorString || VENDORS[vid] || info?.auxAttributes?.glVendor || "").trim();
  let gpu = String(active.deviceString || info?.auxAttributes?.glRenderer || "").trim();
  gpu = gpu.replace(/^ANGLE \((.+)\)$/s, "$1").replace(/\s+/g, " ");
  if (!vendor && /nvidia/i.test(gpu)) vendor = "NVIDIA";
  if (!vendor && /amd|radeon/i.test(gpu)) vendor = "AMD";
  if (!vendor && /intel/i.test(gpu)) vendor = "Intel";
  if (!vendor && /apple|metal/i.test(gpu)) vendor = "Apple";
  return { vendor, gpu };
}

export function machineFromOs() {
  const cores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus()?.length || 0;
  const ramGb = Math.round((os.totalmem() / 1073741824) * 10) / 10;
  const freeGb = Math.round((os.freemem() / 1073741824) * 10) / 10;
  return {
    cores,
    ramGb,
    freeGb,
    arch: os.arch(),
    platform: process.platform,
  };
}
