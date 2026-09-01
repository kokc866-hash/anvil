/** 127.168.x.x ist Loopback auf diesem PC. Ollama im Netz: 192.168.x.x. */
export function lanAlts(url: string): string[] {
  const out = [url];
  try {
    const u = new URL(url);
    const m = u.hostname.match(/^127\.168\.(\d+\.\d+)$/);
    if (m) {
      const next = new URL(url);
      next.hostname = `192.168.${m[1]}`;
      out.push(next.toString());
    }
  } catch {
    /* */
  }
  return out;
}

export function isLanHost(host: string): boolean {
  const h = String(host || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (h === "169.254.169.254") return false;
  if (h === "localhost" || h === "0.0.0.0" || h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".internal")) return true;
  if (h === "::1" || h === "127.0.0.1") return true;
  const p = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!p) return false;
  const a = Number(p[1]);
  const b = Number(p[2]);
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}
