export type HwProfile = "weak" | "ok" | "strong";

export type HwFacts = {
  cores: number;
  ramGb: number;
  freeGb: number;
  webgpu: boolean;
  fp16: boolean;
  vendor: string;
  gpu: string;
  maxBuffer: number;
  source: "electron" | "browser";
  arch: string;
};

export type HwProbe = HwFacts & {
  profile: HwProfile;
  note: string;
};

function gpuText(p: Pick<HwFacts, "vendor" | "gpu">): string {
  return `${p.vendor} ${p.gpu}`;
}

export function scoreOf(p: HwFacts): { profile: HwProfile; note: string } {
  let n = 0;
  if (p.cores >= 4) n += 1;
  if (p.cores >= 8) n += 1;
  if (p.cores >= 16) n += 1;
  if (p.ramGb >= 8) n += 2;
  if (p.ramGb >= 16) n += 2;
  if (p.ramGb >= 32) n += 1;
  if (p.freeGb > 0 && p.freeGb < 2) n -= 2;
  else if (p.freeGb > 0 && p.freeGb < 4) n -= 1;
  const g = gpuText(p);
  if (/nvidia|geforce|rtx|amd|radeon|apple m[1-9]|metal/i.test(g)) n += 2;
  else if (/intel arc/i.test(g)) n += 1;
  const profile: HwProfile = n >= 6 ? "strong" : n >= 3 ? "ok" : "weak";
  const ram = p.ramGb ? `${p.ramGb} GB RAM` : "RAM unbekannt";
  const free = p.freeGb > 0 ? ` · ${p.freeGb} GB frei` : "";
  const gpu = p.gpu || p.vendor || "";
  const where = p.source === "electron" ? "Rechner" : "Browser grob";
  const helper = p.webgpu ? (p.fp16 ? " · WebGPU fp16" : " · WebGPU") : "";
  const head = profile === "strong" ? "Stark" : profile === "ok" ? "Mittel" : "Sparsam";
  const note = `${head} · ${where} · ${p.cores} Kerne · ${ram}${free}${gpu ? ` · ${gpu}` : ""}${helper}`;
  return { profile, note };
}
