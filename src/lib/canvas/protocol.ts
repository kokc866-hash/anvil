export type CanvasState =
  "loading" | "ready" | "running" | "paused" | "stopped" | "failed" | "disposed";
export type CanvasReply = {
  ok: boolean;
  state: CanvasState;
  error?: string;
  image?: string | null;
  logs: string[];
  w?: number;
  h?: number;
  outputSize?: { width: number; height: number };
  readiness?: { state: "settled" | "live"; waitedMs: number; revision: number; width: number; height: number };
  session: string;
  revision: string;
  observation?: { title: string; text: string; viewport: {width:number;height:number}; elements: Record<string, unknown>[]; observations?: Record<string, unknown>[]; observationsTruncated?: boolean };
  point?: {x:number;y:number};
};
export type CanvasOperation = "ready" | "capture-ready" | "shot" | "keys" | "keys-up" | "input" | "input-up" | "target" | "assert" | "pause" | "stop" | "dispose";
export type CanvasBoot = {
  session: string;
  revision: string;
  local: Record<string, string>;
  storage: Record<string, string>;
};
export const CANVAS_CHANNEL = "anvil-canvas-v2";
