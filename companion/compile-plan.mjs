/** How Anvil compiles a snapshot: sources, includes, manifests. Pure — no spawn. */

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
  const list = (Array.isArray(files) ? files : []).map((f) => norm(typeof f === "string" ? f : f.path));
  const srcExt = SRC[lang] || SRC.cpp;
  const srcs = list.filter((p) => srcExt.includes(extOf(p)));
  const e = norm(entry);
  if (e && !srcs.includes(e)) srcs.unshift(e);
  const unique = [...new Set(srcs.filter(Boolean))];
  const hdrs = list.filter((p) => HDR.includes(extOf(p)));
  const inc = [...new Set(hdrs.map((p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".")))];
  return { srcs: unique, inc };
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
