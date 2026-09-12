import type { EngineHit } from "./engines.ts";

export function engineReady(
  hit: EngineHit,
  companion: { ok: boolean; bins?: Record<string, string | null> },
) {
  const key = hit.id === "unreal" ? "UnrealEditor" : hit.id === "bevy" ? "cargo" : hit.id;
  return Boolean(companion.ok && companion.bins?.[key]);
}

export function planEngineRun(hits: EngineHit[], args: Record<string, unknown> = {}) {
  const action = String(args.action || "check");
  if (!["play", "check", "editor", "test"].includes(action))
    throw new Error("Unbekannte Engine-Aktion. play, check, editor oder test wählen.");
  const selected = hits.filter(
    (hit) =>
      (!args.engine || hit.id === args.engine) &&
      (args.projectRoot === undefined || hit.root === args.projectRoot),
  );
  const custom = String(args.cmd || "").trim();
  if (!custom && selected.length > 1)
    throw new Error(
      "Mehrere Engine-Projekte gefunden. engine und projectRoot aus engine_detect angeben.",
    );
  if ((args.engine || args.projectRoot !== undefined) && selected.length !== 1)
    throw new Error("Engine-Projekt nicht eindeutig gefunden. engine_detect erneut ausführen.");
  const hit = selected.length === 1 ? selected[0] : undefined;
  const cmd = custom || hit?.cmds[action];
  if (!cmd)
    throw new Error(
      hit
        ? `${hit.label} unterstützt hier „${action}“ nicht. Verfügbar: ${Object.keys(hit.cmds).join(", ") || "keine sicheren Standardbefehle"}. Für Editor-Funktionen die Engine-Erweiterung nutzen.`
        : "Kein Engine-Projekt gefunden. Einen Unity-, Unreal- oder Godot-Projektordner öffnen.",
    );
  return { cmd, action: action as "play" | "check" | "editor" | "test", hit };
}
