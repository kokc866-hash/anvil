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

function workspacePath(path: string): string | null {
  const normalized = path.replaceAll("\\", "/").replace(/^(?:\.\/)+/, "").replace(/\/$/, "");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").includes("..")) return null;
  return normalized;
}

// Commands run from the workspace directory on both Windows and POSIX shells.
// Double quotes alone do not stop variable/command expansion in these shells.
function quotePath(path: string): string | null {
  return /["$`%!\x00-\x1f]/.test(path) ? null : `"${path || "."}"`;
}

function named(path: string, name: string): boolean {
  return path === name || path.endsWith(`/${name}`);
}

function bevyDependency(content: string): boolean {
  let section = "";
  for (const raw of content.split(/\r?\n/)) {
    // Strip TOML comments without treating a # inside a quoted value as one.
    let quoted = "";
    let line = "";
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (!quoted && ch === "#") break;
      line += ch;
      if (quoted === '"' && ch === "\\") { line += raw[++i] || ""; continue; }
      if (ch === quoted) quoted = "";
      else if (!quoted && (ch === '"' || ch === "'")) quoted = ch;
    }
    const header = line.trim().match(/^\[([^\]]+)\]$/);
    if (header) {
      section = header[1];
      if (/(?:^|\.)(?:dev-|build-)?dependencies\.["']?bevy["']?$/.test(section)) return true;
    } else if (/(?:^|\.)(?:dev-|build-)?dependencies$/.test(section)) {
      if (/^\s*(?:bevy|"bevy"|'bevy')\s*=/.test(line)) return true;
      if (/^\s*[^=]+\s*=\s*\{[^}]*\bpackage\s*=\s*["']bevy["']/.test(line)) return true;
    }
  }
  return false;
}

export function hasEngineHint(files: Record<string, string>, dirs: string[] = []): boolean {
  return detectEngines(files, dirs).length > 0;
}

export function detectEngines(files: Record<string, string>, dirs: string[] = []): EngineHit[] {
  const entries = Object.entries(files).flatMap(([name, content]) => {
    const path = workspacePath(name);
    return path === null ? [] : [[path, content] as const];
  });
  const names = entries.map(([path]) => path);
  const directories = dirs.map(workspacePath).filter((path): path is string => path !== null);
  const hits: EngineHit[] = [];

  for (const godot of names.filter((p) => named(p, "project.godot"))) {
    const root = parent(godot);
    const path = quotePath(root);
    hits.push({
      id: "godot",
      label: LABEL.godot,
      root,
      evidence: [godot],
      cmds: path ? {
        play: `godot --path ${path}`,
        editor: `godot --editor --path ${path}`,
        // --import waits for editor imports; this is not a gameplay test.
        check: `godot --headless --path ${path} --import`,
      } : {},
    });
  }

  const unityRoots = new Set(names.flatMap((name) => {
    const match = name.match(/^(?:(.*)\/)?ProjectSettings\/ProjectVersion\.txt$/);
    return match ? [match[1] || ""] : [];
  }));
  for (const root of unityRoots) {
    const assets = `${root ? `${root}/` : ""}Assets`;
    if (!names.some((name) => name.startsWith(`${assets}/`)) && !directories.includes(assets)) continue;
    const path = quotePath(root);
    hits.push({
      id: "unity",
      label: LABEL.unity,
      root,
      evidence: names.filter((p) => parent(p) === `${root ? `${root}/` : ""}ProjectSettings`).slice(0, 2),
      cmds: path ? {
        editor: `unity -projectPath ${path}`,
        test: `unity -projectPath ${path} -batchmode -runTests -testPlatform playmode -logFile -`,
      } : {},
    });
  }

  for (const uproject of names.filter((p) => p.endsWith(".uproject"))) {
    const path = quotePath(uproject);
    hits.push({
      id: "unreal",
      label: LABEL.unreal,
      root: parent(uproject),
      evidence: [uproject],
      cmds: path ? { editor: `UnrealEditor ${path}` } : {},
    });
  }

  for (const [cargo, content] of entries.filter(([p]) => named(p, "Cargo.toml"))) {
    if (!bevyDependency(content)) continue;
    const path = quotePath(cargo);
    hits.push({
      id: "bevy",
      label: LABEL.bevy,
      root: parent(cargo),
      evidence: [cargo],
      cmds: path ? { play: `cargo run --manifest-path ${path}`, check: `cargo check --manifest-path ${path}`, test: `cargo test --manifest-path ${path}` } : {},
    });
  }

  for (const defold of names.filter((p) => named(p, "game.project"))) {
    hits.push({
      id: "defold",
      label: LABEL.defold,
      root: parent(defold),
      evidence: [defold],
      cmds: { play: "defold" },
    });
  }

  for (const main of names.filter((p) => named(p, "main.lua"))) {
    const root = parent(main);
    const config = `${root ? `${root}/` : ""}conf.lua`;
    if (!names.includes(config)) continue;
    const path = quotePath(root);
    hits.push({ id: "love", label: LABEL.love, root, evidence: [main, config], cmds: path ? { play: `love ${path}` } : {} });
  }

  for (const yyp of names.filter((p) => p.endsWith(".yyp"))) {
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
  return `Engine project: ${hit.label} (${hit.root || "."}). Edit scripts, then engine_run or MCP. Commands below run from the workspace directory. Do not build an engine inside Anvil.\n${cmds}`;
}
