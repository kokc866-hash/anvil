export const ACTIVITY_W = 44;
export const EDITOR_MIN = 400;
export const SIDE_MIN = 160;
export const SIDE_MAX = 420;
export const TRAIL_MIN = 180;
export const TRAIL_MAX = 560;
export const AGENT_MIN = 240;
export const AGENT_MAX = 640;
export const EDITOR_COMPACT = 480;
export const SPLIT_W = 8;
export const STACK_CHAT_MIN = 200;

export type LayoutFit = {
  overlaySide: boolean;
  overlayAgent: boolean;
  overlayTrail: boolean;
  sideW: number;
  trailW: number;
  agentW: number;
};

export type PaneId = "side" | "trail" | "agent";

function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n));
}

function splitPx(sideW: number, trailW: number, agentW: number) {
  return (sideW > 0 ? SPLIT_W : 0) + (trailW > 0 ? SPLIT_W : 0) + (agentW > 0 ? SPLIT_W : 0);
}

function used(sideW: number, trailW: number, agentW: number) {
  return sideW + trailW + agentW + splitPx(sideW, trailW, agentW);
}

function paneBudget(inner: number) {
  return Math.max(0, inner - ACTIVITY_W - EDITOR_MIN);
}

export function fitIdeLayout(o: {
  inner: number;
  splitMode: "auto" | "side" | "stack";
  sideOn: boolean;
  trailOn: boolean;
  agentOn: boolean;
  sideW: number;
  trailW: number;
  agentW: number;
}): LayoutFit {
  const sideW = o.sideOn ? clamp(o.sideW, SIDE_MIN, SIDE_MAX) : 0;
  const trailW = o.trailOn ? clamp(o.trailW, TRAIL_MIN, TRAIL_MAX) : 0;
  const agentW = o.agentOn ? clamp(o.agentW, AGENT_MIN, AGENT_MAX) : 0;
  const budget = paneBudget(o.inner);

  if (o.splitMode === "stack") {
    return fitHorizontal(budget, {
      sideOn: o.sideOn,
      trailOn: false,
      agentOn: false,
      sideW,
      trailW: 0,
      agentW: 0,
      allowOverlay: true,
    });
  }

  if (o.splitMode === "side") {
    return shrinkRow(budget, {
      sideW,
      trailW,
      agentW,
      overlaySide: false,
      overlayTrail: false,
      overlayAgent: false,
    });
  }

  return fitAuto(budget, { sideOn: o.sideOn, trailOn: o.trailOn, agentOn: o.agentOn, sideW, trailW, agentW });
}

function shrinkRow(budget: number, base: LayoutFit): LayoutFit {
  let { sideW, trailW, agentW } = base;
  if (used(sideW, trailW, agentW) <= budget) return { ...base, sideW, trailW, agentW };
  const extra = used(sideW, trailW, agentW) - budget;
  const room =
    Math.max(0, sideW - (sideW ? SIDE_MIN : 0)) +
    Math.max(0, trailW - (trailW ? TRAIL_MIN : 0)) +
    Math.max(0, agentW - (agentW ? AGENT_MIN : 0));
  if (room <= 0) return { ...base, sideW, trailW, agentW };
  let left = Math.min(extra, room);
  const next = { sideW, trailW, agentW };
  const order: { k: "agentW" | "trailW" | "sideW"; min: number }[] = [
    { k: "agentW", min: agentW ? AGENT_MIN : 0 },
    { k: "trailW", min: trailW ? TRAIL_MIN : 0 },
    { k: "sideW", min: sideW ? SIDE_MIN : 0 },
  ];
  for (const { k, min } of order) {
    if (left <= 0) break;
    const cut = Math.min(left, Math.max(0, next[k] - min));
    next[k] -= cut;
    left -= cut;
  }
  return { ...base, ...next };
}

function fitHorizontal(
  budget: number,
  o: {
    sideOn: boolean;
    trailOn: boolean;
    agentOn: boolean;
    sideW: number;
    trailW: number;
    agentW: number;
    allowOverlay: boolean;
  },
): LayoutFit {
  const row = shrinkRow(budget, {
    overlaySide: false,
    overlayTrail: false,
    overlayAgent: false,
    sideW: o.sideOn ? o.sideW : 0,
    trailW: o.trailOn ? o.trailW : 0,
    agentW: o.agentOn ? o.agentW : 0,
  });
  const n = (o.sideOn ? 1 : 0) + (o.trailOn ? 1 : 0) + (o.agentOn ? 1 : 0);
  const mins = (o.sideOn ? SIDE_MIN : 0) + (o.trailOn ? TRAIL_MIN : 0) + (o.agentOn ? AGENT_MIN : 0) + n * SPLIT_W;
  if (used(row.sideW, row.trailW, row.agentW) <= budget || mins <= budget) return row;
  if (!o.allowOverlay) return row;
  return fitAuto(budget, o);
}

function fitAuto(
  budget: number,
  o: { sideOn: boolean; trailOn: boolean; agentOn: boolean; sideW: number; trailW: number; agentW: number },
): LayoutFit {
  const tryRow = (overlaySide: boolean, overlayTrail: boolean, overlayAgent: boolean): LayoutFit | null => {
    const sideW = overlaySide || !o.sideOn ? 0 : o.sideW;
    const trailW = overlayTrail || !o.trailOn ? 0 : o.trailW;
    const agentW = overlayAgent || !o.agentOn ? 0 : o.agentW;
    const n = (sideW ? 1 : 0) + (trailW ? 1 : 0) + (agentW ? 1 : 0);
    const mins = (sideW ? SIDE_MIN : 0) + (trailW ? TRAIL_MIN : 0) + (agentW ? AGENT_MIN : 0) + n * SPLIT_W;
    if (mins > budget) return null;
    return shrinkRow(budget, {
      overlaySide: overlaySide && o.sideOn,
      overlayTrail: overlayTrail && o.trailOn,
      overlayAgent: overlayAgent && o.agentOn,
      sideW,
      trailW,
      agentW,
    });
  };

  return (
    tryRow(false, false, false) ||
    tryRow(true, false, false) ||
    tryRow(true, true, false) ||
    tryRow(true, true, true) ||
    shrinkRow(budget, {
      overlaySide: o.sideOn,
      overlayTrail: o.trailOn,
      overlayAgent: o.agentOn,
      sideW: 0,
      trailW: 0,
      agentW: 0,
    })
  );
}

/** User drag: keep the moved pane, shrink the others so the editor still fits. */
export function applyPaneDrag(o: {
  inner: number;
  splitMode: "auto" | "side" | "stack";
  sideOn: boolean;
  trailOn: boolean;
  agentOn: boolean;
  sideW: number;
  trailW: number;
  agentW: number;
  pane: PaneId;
  next: number;
}): { sideW: number; trailW: number; agentW: number } {
  const sideW0 = o.sideOn ? clamp(o.sideW, SIDE_MIN, SIDE_MAX) : 0;
  const trailW0 = o.trailOn ? clamp(o.trailW, TRAIL_MIN, TRAIL_MAX) : 0;
  const agentW0 = o.agentOn ? clamp(o.agentW, AGENT_MIN, AGENT_MAX) : 0;
  let sideW = sideW0;
  let trailW = trailW0;
  let agentW = agentW0;

  if (o.splitMode === "stack") {
    if (o.pane === "side" && o.sideOn) {
      const budget = paneBudget(o.inner);
      sideW = clamp(o.next, SIDE_MIN, Math.min(SIDE_MAX, Math.max(SIDE_MIN, budget)));
    } else if (o.pane === "trail" && o.trailOn) {
      trailW = clamp(o.next, TRAIL_MIN, TRAIL_MAX);
    } else if (o.pane === "agent" && o.agentOn) {
      agentW = clamp(o.next, AGENT_MIN, AGENT_MAX);
    }
    return {
      sideW: o.sideOn ? sideW : o.sideW,
      trailW: o.trailOn ? trailW : o.trailW,
      agentW: o.agentOn ? agentW : o.agentW,
    };
  }

  if (o.pane === "side" && o.sideOn) sideW = clamp(o.next, SIDE_MIN, SIDE_MAX);
  if (o.pane === "trail" && o.trailOn) trailW = clamp(o.next, TRAIL_MIN, TRAIL_MAX);
  if (o.pane === "agent" && o.agentOn) agentW = clamp(o.next, AGENT_MIN, AGENT_MAX);

  const budget = paneBudget(o.inner);
  if (used(sideW, trailW, agentW) <= budget) {
    return {
      sideW: o.sideOn ? sideW : o.sideW,
      trailW: o.trailOn ? trailW : o.trailW,
      agentW: o.agentOn ? agentW : o.agentW,
    };
  }

  let left = used(sideW, trailW, agentW) - budget;
  const nextW = { sideW, trailW, agentW };
  const siblings: { k: "agentW" | "trailW" | "sideW"; min: number }[] = [];
  if (o.pane !== "agent" && nextW.agentW) siblings.push({ k: "agentW", min: AGENT_MIN });
  if (o.pane !== "trail" && nextW.trailW) siblings.push({ k: "trailW", min: TRAIL_MIN });
  if (o.pane !== "side" && nextW.sideW) siblings.push({ k: "sideW", min: SIDE_MIN });
  for (const { k, min } of siblings) {
    if (left <= 0) break;
    const cut = Math.min(left, Math.max(0, nextW[k] - min));
    nextW[k] -= cut;
    left -= cut;
  }
  if (left > 0) {
    const k = o.pane === "side" ? "sideW" : o.pane === "trail" ? "trailW" : "agentW";
    const min = o.pane === "side" ? SIDE_MIN : o.pane === "trail" ? TRAIL_MIN : AGENT_MIN;
    nextW[k] = Math.max(min, nextW[k] - left);
  }
  return {
    sideW: o.sideOn ? nextW.sideW : o.sideW,
    trailW: o.trailOn ? nextW.trailW : o.trailW,
    agentW: o.agentOn ? nextW.agentW : o.agentW,
  };
}

export type OverlayPanes = {
  trailW: number;
  agentW: number;
  trailRight: number;
  agentRight: number;
  trailOnTop: boolean;
};

export function overlayPanes(o: {
  inner: number;
  overlayTrail: boolean;
  overlayAgent: boolean;
  trailW: number;
  agentW: number;
  besideAgentW: number;
}): OverlayPanes {
  const room = Math.max(0, o.inner - ACTIVITY_W - o.besideAgentW);
  const wantA = o.overlayAgent ? clamp(o.agentW, AGENT_MIN, AGENT_MAX) : 0;
  const wantT = o.overlayTrail ? clamp(o.trailW, TRAIL_MIN, TRAIL_MAX) : 0;
  let a = wantA ? Math.min(wantA, room) : 0;
  let t = wantT ? Math.min(wantT, room) : 0;
  if (a && t && a + t > room) {
    if (room < TRAIL_MIN + AGENT_MIN) {
      return {
        trailW: Math.min(t, room),
        agentW: Math.min(a, room),
        trailRight: o.besideAgentW,
        agentRight: 0,
        trailOnTop: true,
      };
    }
    const extra = a + t - room;
    const cutT = Math.min(extra, Math.max(0, t - TRAIL_MIN));
    t -= cutT;
    a -= extra - cutT;
  }
  return {
    trailW: t,
    agentW: a,
    trailRight: o.besideAgentW + a,
    agentRight: 0,
    trailOnTop: false,
  };
}

export function fitStackTrail(
  belowW: number,
  trailOn: boolean,
  trailW: number,
): { trailW: number; overlayTrail: boolean } {
  if (!trailOn) return { trailW: 0, overlayTrail: false };
  const w = clamp(trailW, TRAIL_MIN, TRAIL_MAX);
  if (w + STACK_CHAT_MIN <= belowW) return { trailW: w, overlayTrail: false };
  if (TRAIL_MIN + STACK_CHAT_MIN <= belowW) return { trailW: belowW - STACK_CHAT_MIN, overlayTrail: false };
  return { trailW: 0, overlayTrail: true };
}
