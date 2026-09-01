export type PulseKind = "wait" | "think" | "write" | "edit" | "read" | "run" | "search" | "tool";

export function pulseKind(input: {
  busy?: boolean;
  thinking?: string;
  content?: string;
  steps?: { name: string; status: string }[];
}): PulseKind | null {
  if (!input.busy) return null;
  const run = [...(input.steps ?? [])].reverse().find((s) => s.status === "run");
  if (run) {
    const n = run.name.toLowerCase();
    if (/search|grep|find|web/.test(n)) return "search";
    if (/read|list|dir|glob/.test(n)) return "read";
    if (/write|edit|apply|create|mkdir|patch/.test(n)) return "edit";
    if (/run|shell|play|engine|test|compile/.test(n)) return "run";
    return "tool";
  }
  const think = (input.thinking ?? "").trim();
  const text = (input.content ?? "").trim();
  if (think && !text) return "think";
  if (text) return "write";
  return "wait";
}
