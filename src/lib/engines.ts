export type EngineId = "godot" | "unity" | "unreal" | "bevy" | "defold" | "love" | "gms";

export type EngineHit = {
  id: EngineId;
  label: string;
  root: string;
  evidence: string[];
  cmds: Record<string, string>;
};

const LABEL: Record<EngineId, string> = {
  godot: "Godot",
  unity: "Unity",
  unreal: "Unreal",
  bevy: "Bevy",
  defold: "Defold",
  love: "LÖVE",
  gms: "GameMaker",
};

function parent(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export function hasEngineHint(files: Record<string, string>, dirs: string[] = []): boolean {
  for (const p of Object.keys(files)) {
    if (
      p.endsWith("project.godot") ||
      p.endsWith(".uproject") ||
      p.endsWith(".yyp") ||
      p.endsWith("game.project") ||
      p === "main.lua" ||
      p.endsWith("/main.lua") ||
      p.includes("ProjectSettings/") ||
      p.endsWith("Cargo.toml")
    ) {
      return true;
    }
  }
  return dirs.some((d) => d === "Assets" || d.endsWith("/Assets"));
}

export function detectEngines(files: Record<string, string>, dirs: string[] = []): EngineHit[] {
  const names = Object.keys(files);
  const hits: EngineHit[] = [];

  const godot = names.find((p) => p === "project.godot" || p.endsWith("/project.godot"));
  if (godot) {
    const root = parent(godot);
    hits.push({
      id: "godot",
      label: LABEL.godot,
      root,
      evidence: [godot],
      cmds: {
        play: `godot --path "${root || "."}"`,
        editor: `godot --editor --path "${root || "."}"`,
        check: `godot --headless --path "${root || "."}" --quit-after 1`,
      },
    });
  }

  const unityAssets = names.some((p) => p.startsWith("Assets/") || p.includes("/Assets/")) || dirs.some((d) => d === "Assets" || d.endsWith("/Assets"));
  const unitySet = names.some((p) => p.startsWith("ProjectSettings/") || p.includes("/ProjectSettings/"));
  if (unityAssets && unitySet) {
    hits.push({
      id: "unity",
      label: LABEL.unity,
      root: "",
      evidence: names.filter((p) => p.includes("ProjectSettings")).slice(0, 2),
      cmds: {
        editor: "unity -projectPath .",
        test: "unity -projectPath . -batchmode -runTests -testPlatform playmode -logFile -",
      },
    });
  }

  const uproject = names.find((p) => p.endsWith(".uproject"));
  if (uproject) {
    hits.push({
      id: "unreal",
      label: LABEL.unreal,
      root: parent(uproject),
      evidence: [uproject],
      cmds: { editor: `UnrealEditor "${uproject}"` },
    });
  }

  const cargo = names.find((p) => p === "Cargo.toml" || p.endsWith("/Cargo.toml"));
  if (cargo && /bevy/i.test(files[cargo] ?? "")) {
    hits.push({
      id: "bevy",
      label: LABEL.bevy,
      root: parent(cargo),
      evidence: [cargo],
      cmds: { play: "cargo run", check: "cargo check", test: "cargo test" },
    });
  }

  const defold = names.find((p) => p === "game.project" || p.endsWith("/game.project"));
  if (defold) {
    hits.push({
      id: "defold",
      label: LABEL.defold,
      root: parent(defold),
      evidence: [defold],
      cmds: { play: "defold" },
    });
  }

  if (names.includes("main.lua") && names.some((p) => p === "conf.lua" || p.endsWith("/conf.lua"))) {
    hits.push({ id: "love", label: LABEL.love, root: "", evidence: ["main.lua"], cmds: { play: "love ." } });
  }

  const yyp = names.find((p) => p.endsWith(".yyp"));
  if (yyp) {
    hits.push({
      id: "gms",
      label: LABEL.gms,
      root: parent(yyp),
      evidence: [yyp],
      cmds: { play: "GameMaker" },
    });
  }

  return hits;
}

export function primaryEngine(files: Record<string, string>, dirs: string[] = []): EngineHit | null {
  return detectEngines(files, dirs)[0] ?? null;
}

export function enginePrompt(hit: EngineHit | null): string {
  if (!hit) return "";
  const cmds = Object.entries(hit.cmds)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n");
  return `Engine project: ${hit.label} (${hit.root || "."}). Edit scripts, then engine_run or MCP. Do not build an engine inside Anvil.\n${cmds}`;
}
