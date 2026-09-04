import { gpuInfo } from "@/lib/brain/engine";
import { useBrain } from "@/lib/brain/store";
import { useIde } from "@/store/ide";
import { scoreOf, type HwFacts, type HwProbe } from "./hw-score";

export type { HwFacts, HwProbe, HwProfile } from "./hw-score";
export { scoreOf };

type NativeHw = {
  hwMachine?: () => Promise<{
    cores: number;
    ramGb: number;
    freeGb: number;
    vendor?: string;
    gpu?: string;
    arch?: string;
    source?: string;
  }>;
};

function nativeHw(): NativeHw | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { anvilNative?: NativeHw }).anvilNative ?? null;
}

export async function probeHw(): Promise<HwProbe> {
  const coresNav = navigator.hardwareConcurrency || 4;
  const ramNav = (navigator as Navigator & { deviceMemory?: number }).deviceMemory || 0;
  let cores = coresNav;
  let ramGb = ramNav;
  let freeGb = 0;
  let vendor = "";
  let gpuName = "";
  let arch = "";
  let source: "electron" | "browser" = "browser";
  const nat = nativeHw();
  if (nat?.hwMachine) {
    try {
      const m = await nat.hwMachine();
      if (m.cores) cores = m.cores;
      if (m.ramGb) ramGb = m.ramGb;
      if (m.freeGb) freeGb = m.freeGb;
      vendor = m.vendor || "";
      gpuName = m.gpu || "";
      arch = m.arch || "";
      source = "electron";
    } catch {
      /* Browser-Fallback */
    }
  }
  const gpu = await gpuInfo();
  const base: HwFacts = {
    cores,
    ramGb,
    freeGb,
    webgpu: gpu.ok,
    fp16: gpu.fp16,
    vendor: vendor || gpu.vendor,
    gpu: gpuName || gpu.info,
    maxBuffer: gpu.maxBuffer,
    source,
    arch,
  };
  const { profile, note } = scoreOf(base);
  return { ...base, profile, note };
}

function tuneHelper(p: HwProbe): void {
  if (!p.webgpu) return;
  const brain = useBrain.getState();
  brain.setUseWorker(true);
  brain.setGpuFitBuffer(true);
  if (p.profile === "weak") {
    brain.setGpuPower("low-power");
    brain.setGpuWarmShaders(false);
    brain.setSliding(true);
    brain.setContext(2048);
    brain.setMaxTokens(256);
    brain.setCustomId("");
    brain.setModelId("SmolLM2-360M-Instruct-q4f16_1-MLC");
  } else if (p.profile === "ok") {
    brain.setGpuPower("high-performance");
    brain.setGpuWarmShaders(true);
    brain.setSliding(true);
    brain.setContext(8192);
    brain.setMaxTokens(512);
    brain.setCustomId("");
    brain.setModelId("Qwen2.5-0.5B-Instruct-q4f16_1-MLC");
  } else {
    brain.setGpuPower("high-performance");
    brain.setGpuWarmShaders(true);
    brain.setSliding(false);
    brain.setContext(16384);
    brain.setMaxTokens(1024);
    brain.setCustomId("");
    brain.setModelId("Qwen3.5-0.8B-q4f16_1-MLC");
  }
}

export async function applyHwTune(): Promise<HwProbe> {
  const p = await probeHw();
  const ide = useIde.getState();
  const brain = useBrain.getState();
  const before = brain.customId.trim() || brain.modelId;
  if (p.profile === "weak") {
    ide.setMotion("reduced");
    ide.setLiveRun(false);
    ide.setLlmRetries(2);
    ide.setLoopTries(2);
    ide.setGraphSees(2);
    ide.setLlmCompact("aggressive");
  } else if (p.profile === "ok") {
    ide.setMotion("full");
    ide.setLiveRun(true);
    ide.setLlmRetries(3);
    ide.setLoopTries(3);
    ide.setGraphSees(4);
    ide.setLlmCompact("auto");
  } else {
    ide.setMotion("full");
    ide.setLiveRun(true);
    ide.setLlmRetries(4);
    ide.setLoopTries(4);
    ide.setGraphSees(6);
    ide.setLlmCompact("auto");
  }
  tuneHelper(p);
  ide.setHwNote(p.note);
  ide.setNotice(p.note);
  const after = useBrain.getState().modelId;
  if (p.webgpu && brain.on && before !== after) {
    void import("@/lib/brain").then((b) => b.loadBrain(true));
  }
  return p;
}
