/** Real machine probe for Layout → Hardware. Not WebGPU (that's the helper). */
import { app } from "electron";
import { handleOnce } from "./ipc.mjs";
import { machineFromOs, parseGpuInfo } from "./hw-parse.mjs";

export { machineFromOs, parseGpuInfo };

export async function machineHw() {
  const base = machineFromOs();
  let vendor = "";
  let gpu = "";
  try {
    const info = await app.getGPUInfo("complete");
    const parsed = parseGpuInfo(info);
    vendor = parsed.vendor;
    gpu = parsed.gpu;
  } catch {
    /* */
  }
  return { ...base, vendor, gpu, source: "electron" };
}

export function bindHwIpc() {
  handleOnce("hw-machine", () => machineHw());
}
