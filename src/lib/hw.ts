import { gpuInfo } from "@/lib/brain/engine";
import { useBrain } from "@/lib/brain/store";
import { useIde } from "@/store/ide";

export type HwProfile = "weak" | "ok" | "strong";

export type HwProbe = {
  cores: number;
  ramGb: number;
  webgpu: boolean;
  fp16: boolean;
  vendor: string;
  gpu: string;
  maxBuffer: number;
  profile: HwProfile;
  note: string;
};

function scoreOf(p: Omit<HwProbe, "profile" | "note">): { profile: HwProfile; note: string } {
  let n = 0;
  if (p.webgpu) n += 2;
  if (p.fp16) n += 1;
  if (p.maxBuffer >= 1_000_000_000) n += 2;
  if (p.maxBuffer >= 2_000_000_000) n += 1;
  if (/nvidia|geforce|rtx|amd|radeon|rx\s?\d/i.test(`${p.vendor} ${p.gpu}`)) n += 2;
  if (/intel|mali|adreno/i.test(p.vendor) && !/nvidia|amd|radeon/i.test(`${p.vendor} ${p.gpu}`)) n -= 1;
  if (p.cores >= 8) n += 1;
  if (p.cores >= 12) n += 1;
  if (p.ramGb >= 16) n += 1;
  if (!p.webgpu) n = Math.min(n, 2);
  const profile: HwProfile = n >= 7 ? "strong" : n >= 4 ? "ok" : "weak";
  const ram = p.ramGb ? `${p.ramGb} GB RAM` : "RAM unbekannt";
  const note = `${profile === "strong" ? "Stark" : profile === "ok" ? "Mittel" : "Sparsam"} · ${p.cores} Kerne · ${ram}${p.gpu ? ` · ${p.gpu}` : p.webgpu ? "" : " · kein WebGPU"}`;
  return { profile, note };
}

export async function probeHw(): Promise<HwProbe> {
  const cores = navigator.hardwareConcurrency || 4;
  const ramGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory || 0;
  const gpu = await gpuInfo();
  const base = {
    cores,
    ramGb,
    webgpu: gpu.ok,
    fp16: gpu.fp16,
    vendor: gpu.vendor,
    gpu: gpu.info,
    maxBuffer: gpu.maxBuffer,
  };
  const { profile, note } = scoreOf(base);
  return { ...base, profile, note };
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
    brain.setGpuPower("low-power");
    brain.setUseWorker(true);
    brain.setGpuKeepAlive(false);
    brain.setGpuFitBuffer(true);
    brain.setGpuWarmShaders(false);
    brain.setSliding(true);
    brain.setContext(2048);
    brain.setMaxTokens(256);
    brain.setCustomId("");
    brain.setModelId("SmolLM2-360M-Instruct-q4f16_1-MLC");
  } else if (p.profile === "ok") {
    ide.setMotion("full");
    ide.setLiveRun(true);
    ide.setLlmRetries(3);
    ide.setLoopTries(3);
    ide.setGraphSees(4);
    ide.setLlmCompact("auto");
    brain.setGpuPower("high-performance");
    brain.setUseWorker(true);
    brain.setGpuKeepAlive(true);
    brain.setGpuFitBuffer(true);
    brain.setGpuWarmShaders(true);
    brain.setSliding(true);
    brain.setContext(8192);
    brain.setMaxTokens(512);
    brain.setCustomId("");
    brain.setModelId("Qwen2.5-0.5B-Instruct-q4f16_1-MLC");
  } else {
    ide.setMotion("full");
    ide.setLiveRun(true);
    ide.setLlmRetries(4);
    ide.setLoopTries(4);
    ide.setGraphSees(6);
    ide.setLlmCompact("auto");
    brain.setGpuPower("high-performance");
    brain.setUseWorker(true);
    brain.setGpuKeepAlive(true);
    brain.setGpuFitBuffer(true);
    brain.setGpuWarmShaders(true);
    brain.setSliding(false);
    brain.setContext(16384);
    brain.setMaxTokens(1024);
    brain.setCustomId("");
    brain.setModelId("Qwen3.5-0.8B-q4f16_1-MLC");
  }
  ide.setHwNote(p.note);
  ide.setNotice(p.note);
  const after = useBrain.getState().modelId;
  if (brain.on && before !== after) {
    void import("@/lib/brain").then((b) => b.loadBrain(true));
  }
  return p;
}
