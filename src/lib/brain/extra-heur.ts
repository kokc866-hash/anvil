export function heuristicTabHint(path: string, src: string): string {
  const name = path.split("/").pop() ?? path;
  const c = src.match(/^\s*(?:\/\/|#|\/\*\*?\s*)(.{8,80})/m);
  if (c?.[1]) return c[1].replace(/\*\/$/, "").replace(/\s+/g, " ").trim().slice(0, 72);
  const fn = src.match(/(?:export\s+)?(?:async\s+)?(?:function|def|class|fn|func)\s+([A-Za-z_]\w*)/);
  if (fn?.[1]) return `${name} · ${fn[1]}`;
  return name;
}

export function heuristicStopNote(steps: { name: string; detail?: string; status: string }[]): string {
  const done = steps.filter((s) => s.status === "ok").slice(-6);
  if (!done.length) return "Nichts geschrieben. Nochmal senden setzt hier an.";
  return done
    .map((s) => `- ${s.name}${s.detail ? ` ${s.detail.slice(0, 48)}` : ""}`)
    .slice(0, 3)
    .join("\n");
}

export function heuristicLogTrim(stderr: string): string {
  const lines = stderr
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^at\s/.test(l));
  const err = lines.filter((l) => /error|exception|fail|panic|traceback/i.test(l));
  const pick = (err.length ? err : lines).slice(-5);
  return pick.join("\n").slice(0, 500);
}

export function heuristicI18nKey(s: string): string {
  const t = s
    .replace(/['"]/g, "")
    .replace(/[äÄ]/g, "ae")
    .replace(/[öÖ]/g, "oe")
    .replace(/[üÜ]/g, "ue")
    .replace(/ß/g, "ss")
    .trim();
  const parts = t
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 5);
  if (!parts.length) return "label";
  return parts
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join("");
}

export function heuristicMention(
  q: string,
  files: string[],
  ctx: { dirty: string[]; recent: string[]; active: string | null },
): string[] {
  const n = q.toLowerCase();
  const score = (p: string) => {
    const b = (p.split("/").pop() ?? p).toLowerCase();
    let s = 0;
    if (ctx.active === p) s += 8;
    if (ctx.dirty.includes(p)) s += 5;
    const ri = ctx.recent.indexOf(p);
    if (ri >= 0) s += Math.max(0, 4 - ri);
    if (n && (p.toLowerCase().includes(n) || b.includes(n))) s += 6;
    if (n && b.startsWith(n)) s += 4;
    return s;
  };
  return [...files].sort((a, b) => score(b) - score(a) || a.localeCompare(b)).slice(0, 10);
}

export function heuristicComment(lang: string, code: string): string {
  const first = code.trim().split("\n")[0]?.slice(0, 80) ?? "";
  const name = first.match(/(?:function|def|class|fn|const|let)\s+([A-Za-z_]\w*)/)?.[1] ?? "";
  const body = name ? `${name}` : first.replace(/[{};]+$/g, "").trim().slice(0, 48);
  if (/^py|python$/i.test(lang)) return `# ${body}`;
  if (/^html|xml$/i.test(lang)) return `<!-- ${body} -->`;
  return `// ${body}`;
}

export function leftoverSecretHints(text: string): string[] {
  const hits: string[] = [];
  const after = text.replace(/\[redacted\]/gi, "");
  const re = [
    /\bsk-[A-Za-z0-9]{8,}\b/g,
    /\beyJ[A-Za-z0-9_-]{12,}\./g,
    /\b(api[_-]?key|secret|password|token|passwd)\s*[:=]\s*\S{8,}/gi,
  ];
  for (const p of re) {
    const m = after.match(p);
    if (m) hits.push(...m.slice(0, 2));
  }
  return [...new Set(hits)].slice(0, 4);
}
