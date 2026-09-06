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
  session: string;
  revision: string;
};
export type CanvasOperation = "ready" | "shot" | "keys" | "keys-up" | "pause" | "stop" | "dispose";
export type CanvasBoot = {
  session: string;
  revision: string;
  local: Record<string, string>;
  storage: Record<string, string>;
};
export const CANVAS_CHANNEL = "anvil-canvas-v2";
