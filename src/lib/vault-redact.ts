export function envNames(src: string): string[] {
  return [...src.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((m) => m[1] ?? "").filter(Boolean);
}

export function redactPatterns(text: string): { text: string; n: number } {
  const pats = [
    /\bsk-[A-Za-z0-9]{16,}\b/g,
    /\bsk-proj-[A-Za-z0-9_-]{16,}\b/g,
    /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
    /\bxai-[A-Za-z0-9]{16,}\b/g,
    /\bghp_[A-Za-z0-9]{20,}\b/g,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    /\bAIza[A-Za-z0-9_-]{20,}\b/g,
    /\bAKIA[A-Z0-9]{16}\b/g,
    /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    /\bBearer\s+[A-Za-z0-9._\-+=/]{12,}/gi,
    /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
  ];
  let n = 0;
  let out = text;
  for (const p of pats) {
    out = out.replace(p, () => {
      n += 1;
      return "[redacted]";
    });
  }
  return { text: out, n };
}

export function redactValues(text: string, values: string[]): { text: string; n: number } {
  let n = 0;
  let out = text;
  for (const v of values) {
    const t = v.trim();
    if (t.length < 8 || !out.includes(t)) continue;
    out = out.split(t).join("[redacted]");
    n += 1;
  }
  return { text: out, n };
}
