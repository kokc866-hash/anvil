/** How Anvil compiles a snapshot: sources, includes, manifests. Pure — no spawn. */
import path from "node:path";
import { createHash } from "node:crypto";

const SRC = {
  c: [".c"],
  cpp: [".c", ".cc", ".cpp", ".cxx"],
};
const HDR = [".h", ".hpp", ".hh", ".hxx"];

function norm(p) {
  return String(p || "").replaceAll("\\", "/").replace(/^\/+/, "");
}

function extOf(p) {
  const n = norm(p);
  const i = n.lastIndexOf(".");
  return i >= 0 ? n.slice(i).toLowerCase() : "";
}

export function nativeSources(files, lang, entry) {
  const rows = Array.isArray(files) ? files : [];
  const list = rows.map((f) => norm(typeof f === "string" ? f : f.path));
  const contents = new Map(rows.filter((f) => typeof f !== "string").map((f) => [norm(f.path), String(f.content || "")]));
  const srcExt = SRC[lang] || SRC.cpp;
  const srcs = list.filter((p) => srcExt.includes(extOf(p)));
  const e = norm(entry);
  if (e && !srcs.includes(e)) srcs.unshift(e);
  const unique = [...new Set([e, ...srcs].filter(Boolean))].filter((p) => p === e || !definesEntry(contents.get(p) || ""));
  const hdrs = list.filter((p) => HDR.includes(extOf(p)));
  const inc = [...new Set(hdrs.map((p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".")))];
  return { srcs: unique, inc };
}

export function definesEntry(source) {
  const code = String(source).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, " ");
  return /\b(?:main|wmain|WinMain|wWinMain)\s*\([^;{}]*\)\s*(?:noexcept\s*)?\{/m.test(code);
}

/** C helper units retain C semantics when the selected entry is C++. */
export function nativeCompileSteps(compiler, lang, entry, files, out) {
  const { srcs, inc } = nativeSources(files, lang, entry);
  const cUnits = lang === "cpp" ? srcs.filter((p) => /\.c$/i.test(p)) : [];
  if (!cUnits.length) return [{ file: compiler, args: ccArgs(compiler, lang, entry, files, out) }];
  const zig = /(^|[\\/])zig(?:\.exe)?$/i.test(compiler);
  const objects = cUnits.map((source) => ({ source, out: path.join(path.dirname(out), `${createHash("sha256").update(source).digest("hex").slice(0, 12)}.o`) }));
  const steps = objects.map((obj) => ({ file: compiler, args: [...(zig ? ["cc"] : []), "-x", "c", "-c", obj.source, ...inc.map((d) => "-I" + d), "-o", obj.out] }));
  const args = [...(zig ? ["c++"] : []), ...srcs.filter((p) => !cUnits.includes(p)), ...objects.map((o) => o.out), ...inc.map((d) => "-I" + d), "-o", out];
  return [...steps, { file: compiler, args }];
}

export function ccArgs(compiler, lang, entry, files, out) {
  const base = String(compiler || "").replace(/\\/g, "/").split("/").pop() || "";
  const zig = /zig/i.test(base);
  const { srcs, inc } = nativeSources(files, lang, entry);
  const dash = zig ? [lang === "c" ? "cc" : "c++"] : [];
  const includes = inc.map((d) => "-I" + d);
  return [...dash, ...srcs, ...includes, "-o", out];
}

export function javaMainClass(entry, source) {
  const base = norm(entry).split("/").pop()?.replace(/\.java$/i, "") || "Main";
  const m = String(source || "").match(/^\s*package\s+([\w.]+)\s*;/m);
  return m ? `${m[1]}.${base}` : base;
}

export function hasFile(files, re) {
  return (Array.isArray(files) ? files : []).some((f) => re.test(norm(typeof f === "string" ? f : f.path)));
}

export function isCargo(files) {
  return hasFile(files, /(^|\/)Cargo\.toml$/i);
}

export function isGoMod(files) {
  return hasFile(files, /(^|\/)go\.mod$/i);
}

export function isCsproj(files) {
  return hasFile(files, /\.csproj$/i);
}

export function firstCsproj(files) {
  const hit = (Array.isArray(files) ? files : []).find((f) => /\.csproj$/i.test(norm(typeof f === "string" ? f : f.path)));
  return hit ? norm(typeof hit === "string" ? hit : hit.path) : "";
}

export function looksGui(files) {
  const blob = (Array.isArray(files) ? files : [])
    .map((f) => String(typeof f === "string" ? "" : f.content || ""))
    .join("\n");
  return /WinMain\s*\(|CreateWindowW?\s*\(|ShowWindow\s*\(|RegisterClassW?\s*\(|glfwInit|glfwCreateWindow|SDL_Init|sf::RenderWindow|QApplication|QWidget|gtk_init|HWND\b|tkinter|pygame|raylib|SFML|glutInit|wxApp|ImGui/i.test(
    blob,
  );
}

export function looksTerminal(files) {
  const blob = (Array.isArray(files) ? files : []).map((f) => String(f.content || "")).join("\n");
  return /\b(?:import\s+curses|from\s+curses|curses\.|initscr\s*\(|_?getch(?:ar)?\s*\(|_?kbhit\s*\(|ReadConsoleInput\w*\s*\(|tcsetattr\s*\(|input\s*\(|std::cin|scanf\s*\()/m.test(blob);
}
