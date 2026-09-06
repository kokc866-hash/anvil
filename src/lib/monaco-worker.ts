/** Absolute Monaco `vs` URL + worker bootstrap (path-only URLs break inside workers). */
export function monacoVsAbs(vsBase: string, origin: string): string {
  const o = String(origin || "").replace(/\/$/, "");
  const b = String(vsBase || "").replace(/\/$/, "");
  if (!b) return o;
  if (/^https?:\/\//i.test(b)) return b;
  if (!o) return b.startsWith("/") ? b : `/${b}`;
  return `${o}${b.startsWith("/") ? b : `/${b}`}`;
}

export function monacoWorkerBootstrap(vsAbs: string): string {
  const vs = String(vsAbs || "").replace(/\/$/, "");
  const main = `${vs}/base/worker/workerMain.js`;
  const base = vs.replace(/\/vs$/, "") + "/";
  return `self.MonacoEnvironment={baseUrl:${JSON.stringify(base)}};importScripts(${JSON.stringify(main)});`;
}
