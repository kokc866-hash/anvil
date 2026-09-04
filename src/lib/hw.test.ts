import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreOf, type HwFacts } from "./hw-score.ts";

function facts(p: Partial<HwFacts>): HwFacts {
  return {
    cores: 4,
    ramGb: 8,
    freeGb: 4,
    webgpu: false,
    fp16: false,
    vendor: "",
    gpu: "",
    maxBuffer: 0,
    source: "electron",
    arch: "x64",
    ...p,
  };
}

describe("hw score is the machine, not WebGPU", () => {
  it("strong PC without WebGPU is still strong", () => {
    const s = scoreOf(facts({ cores: 16, ramGb: 32, freeGb: 20, vendor: "NVIDIA", gpu: "RTX 4070", webgpu: false }));
    assert.equal(s.profile, "strong");
    assert.match(s.note, /Rechner/);
    assert.doesNotMatch(s.note, /WebGPU/);
  });
  it("does not cap at weak just because WebGPU is missing", () => {
    const s = scoreOf(facts({ cores: 8, ramGb: 16, freeGb: 8, webgpu: false }));
    assert.notEqual(s.profile, "weak");
  });
  it("small laptop is weak", () => {
    const s = scoreOf(facts({ cores: 2, ramGb: 4, freeGb: 0.8, webgpu: true, fp16: true }));
    assert.equal(s.profile, "weak");
  });
  it("8 GB 4 cores is ok even without WebGPU", () => {
    const s = scoreOf(facts({ cores: 4, ramGb: 8, freeGb: 5, webgpu: false }));
    assert.equal(s.profile, "ok");
  });
  it("browser source is labeled grob", () => {
    const s = scoreOf(facts({ source: "browser", cores: 8, ramGb: 8 }));
    assert.match(s.note, /Browser grob/);
  });
});
