import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGENT_MIN,
  applyPaneDrag,
  EDITOR_MIN,
  fitIdeLayout,
  fitStackTrail,
  overlayPanes,
  SIDE_MIN,
  TRAIL_MIN,
} from "./layout.ts";

const base = {
  sideOn: true,
  trailOn: true,
  agentOn: true,
  sideW: 232,
  trailW: 300,
  agentW: 380,
};

describe("fitIdeLayout", () => {
  it("keeps all panes beside on a wide window", () => {
    const f = fitIdeLayout({ ...base, inner: 1400, splitMode: "auto" });
    assert.equal(f.overlaySide, false);
    assert.equal(f.overlayTrail, false);
    assert.equal(f.overlayAgent, false);
    assert.equal(f.sideW, 232);
    assert.equal(f.trailW, 300);
    assert.equal(f.agentW, 380);
  });

  it("fits the default 1280 desktop without overlay", () => {
    const f = fitIdeLayout({ ...base, inner: 1280, splitMode: "auto" });
    assert.equal(f.overlaySide, false);
    assert.equal(f.overlayTrail, false);
    assert.equal(f.overlayAgent, false);
    assert.ok(f.sideW + f.trailW + f.agentW <= 1280 - 44 - EDITOR_MIN);
    assert.ok(f.agentW < 380);
  });

  it("shrinks before overlaying on a medium window", () => {
    const f = fitIdeLayout({ ...base, inner: 1100, splitMode: "auto" });
    assert.equal(f.overlaySide, false);
    assert.equal(f.overlayTrail, false);
    assert.equal(f.overlayAgent, false);
    const used = f.sideW + f.trailW + f.agentW;
    assert.ok(used <= 1100 - 44 - EDITOR_MIN);
    assert.ok(f.sideW >= SIDE_MIN);
    assert.ok(f.trailW >= TRAIL_MIN);
    assert.ok(f.agentW >= AGENT_MIN);
  });

  it("overlays the sidebar so editor + spur + agent still fit", () => {
    const f = fitIdeLayout({ ...base, inner: 900, splitMode: "auto" });
    assert.equal(f.overlaySide, true);
    assert.equal(f.overlayTrail, false);
    assert.equal(f.overlayAgent, false);
    assert.equal(f.sideW, 0);
    assert.ok(f.trailW + f.agentW <= 900 - 44 - EDITOR_MIN);
  });

  it("overlays sidebar and spur before covering the agent", () => {
    const f = fitIdeLayout({ ...base, inner: 720, splitMode: "auto" });
    assert.equal(f.overlaySide, true);
    assert.equal(f.overlayTrail, true);
    assert.equal(f.overlayAgent, false);
    assert.ok(f.agentW >= AGENT_MIN);
  });

  it("overlays everything on a phone-sized window", () => {
    const f = fitIdeLayout({ ...base, inner: 420, splitMode: "auto" });
    assert.equal(f.overlaySide, true);
    assert.equal(f.overlayTrail, true);
    assert.equal(f.overlayAgent, true);
    assert.equal(f.sideW + f.trailW + f.agentW, 0);
  });

  it("never overlays in side mode, only shrinks", () => {
    const f = fitIdeLayout({ ...base, inner: 720, splitMode: "side" });
    assert.equal(f.overlaySide, false);
    assert.equal(f.overlayTrail, false);
    assert.equal(f.overlayAgent, false);
    assert.ok(f.sideW >= SIDE_MIN);
    assert.ok(f.trailW >= TRAIL_MIN);
    assert.ok(f.agentW >= AGENT_MIN);
  });

  it("stack mode keeps trail and agent out of the editor row", () => {
    const f = fitIdeLayout({ ...base, inner: 900, splitMode: "stack" });
    assert.equal(f.overlayAgent, false);
    assert.equal(f.overlayTrail, false);
    assert.equal(f.agentW, 0);
    assert.equal(f.trailW, 0);
    assert.equal(f.overlaySide, false);
    assert.equal(f.sideW, 232);
  });

  it("stack overlays sidebar when the editor row is too tight", () => {
    const f = fitIdeLayout({ ...base, inner: 420, splitMode: "stack" });
    assert.equal(f.overlaySide, true);
    assert.equal(f.sideW, 0);
    assert.equal(f.agentW, 0);
    assert.equal(f.trailW, 0);
  });
});

describe("applyPaneDrag", () => {
  const shown = () => fitIdeLayout({ ...base, inner: 1280, splitMode: "auto" });

  it("growing the agent at 1280 keeps the new width and shrinks siblings", () => {
    const before = shown();
    const after = applyPaneDrag({
      ...base,
      inner: 1280,
      splitMode: "auto",
      sideW: before.sideW,
      trailW: before.trailW,
      agentW: before.agentW,
      pane: "agent",
      next: before.agentW + 40,
    });
    assert.ok(after.agentW > before.agentW);
    assert.equal(after.agentW, before.agentW + 40);
    const fit = fitIdeLayout({ ...base, inner: 1280, splitMode: "auto", ...after });
    assert.equal(fit.agentW, after.agentW);
    assert.equal(fit.overlayAgent, false);
  });

  it("shrinking the agent at 1280 actually shrinks it", () => {
    const before = shown();
    const after = applyPaneDrag({
      ...base,
      inner: 1280,
      splitMode: "auto",
      sideW: before.sideW,
      trailW: before.trailW,
      agentW: before.agentW,
      pane: "agent",
      next: before.agentW - 40,
    });
    assert.equal(after.agentW, before.agentW - 40);
    const fit = fitIdeLayout({ ...base, inner: 1280, splitMode: "auto", ...after });
    assert.equal(fit.agentW, after.agentW);
  });

  it("growing the trail at 1280 keeps the new width", () => {
    const before = shown();
    const after = applyPaneDrag({
      ...base,
      inner: 1280,
      splitMode: "auto",
      sideW: before.sideW,
      trailW: before.trailW,
      agentW: before.agentW,
      pane: "trail",
      next: before.trailW + 30,
    });
    assert.equal(after.trailW, before.trailW + 30);
    const fit = fitIdeLayout({ ...base, inner: 1280, splitMode: "auto", ...after });
    assert.equal(fit.trailW, after.trailW);
  });

  it("growing the sidebar at 1280 keeps the new width", () => {
    const before = shown();
    const after = applyPaneDrag({
      ...base,
      inner: 1280,
      splitMode: "auto",
      sideW: before.sideW,
      trailW: before.trailW,
      agentW: before.agentW,
      pane: "side",
      next: before.sideW + 24,
    });
    assert.equal(after.sideW, before.sideW + 24);
    const fit = fitIdeLayout({ ...base, inner: 1280, splitMode: "auto", ...after });
    assert.equal(fit.sideW, after.sideW);
  });

  it("caps the drag when siblings are already at their mins", () => {
    const after = applyPaneDrag({
      inner: 1100,
      splitMode: "auto",
      sideOn: true,
      trailOn: true,
      agentOn: true,
      sideW: SIDE_MIN,
      trailW: TRAIL_MIN,
      agentW: AGENT_MIN,
      pane: "agent",
      next: AGENT_MIN + 200,
    });
    assert.ok(after.agentW > AGENT_MIN);
    assert.equal(after.sideW, SIDE_MIN);
    assert.equal(after.trailW, TRAIL_MIN);
    const budget = 1100 - 44 - EDITOR_MIN;
    assert.ok(after.sideW + after.trailW + after.agentW + 24 <= budget);
  });
});

describe("overlayPanes", () => {
  it("sits trail to the left of an in-flow agent", () => {
    const o = overlayPanes({
      inner: 900,
      overlayTrail: true,
      overlayAgent: false,
      trailW: 300,
      agentW: 380,
      besideAgentW: 260,
    });
    assert.equal(o.trailOnTop, false);
    assert.equal(o.trailW, 300);
    assert.equal(o.agentW, 0);
    assert.equal(o.trailRight, 260);
  });

  it("stacks trail on top of agent when both overlays cannot sit side by side", () => {
    const o = overlayPanes({
      inner: 420,
      overlayTrail: true,
      overlayAgent: true,
      trailW: 300,
      agentW: 380,
      besideAgentW: 0,
    });
    assert.equal(o.trailOnTop, true);
    assert.equal(o.trailRight, 0);
    assert.equal(o.agentRight, 0);
    assert.ok(o.trailW > 0);
    assert.ok(o.agentW > 0);
  });
});

describe("fitStackTrail", () => {
  it("keeps trail beside chat when the below-row is wide", () => {
    const s = fitStackTrail(700, true, 300);
    assert.equal(s.overlayTrail, false);
    assert.equal(s.trailW, 300);
  });

  it("shrinks trail before overlaying in the below-row", () => {
    const s = fitStackTrail(420, true, 300);
    assert.equal(s.overlayTrail, false);
    assert.equal(s.trailW, 220);
  });

  it("overlays trail when even the mins do not fit", () => {
    const s = fitStackTrail(300, true, 300);
    assert.equal(s.overlayTrail, true);
    assert.equal(s.trailW, 0);
  });
});
