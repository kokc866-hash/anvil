/** Host/URL policy for server-side fetch (no SSRF to loopback/link-local). */

export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" ||
    h === "0.0.0.0" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".lan")
  ) {
    return true;
  }
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  const v4mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4mapped) return isPrivateHost(v4mapped[1]);
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const a = Number(ipv4[1]);
  const b = Number(ipv4[2]);
  if (a === 10 || a === 127 || a === 0 || a === 169) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function publicHttpUrl(raw: string): URL {
  const url = new URL(raw.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Nur http(s)");
  if (isPrivateHost(url.hostname)) throw new Error("Lokale Hosts sind gesperrt.");
  return url;
}

export async function fetchPublic(raw: string, init?: RequestInit): Promise<Response> {
  let url = publicHttpUrl(raw);
  for (let i = 0; i < 5; i++) {
    const res = await fetch(url.toString(), {
      ...init,
      redirect: "manual",
      signal: init?.signal ?? AbortSignal.timeout(12000),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      url = publicHttpUrl(new URL(loc, url).toString());
      continue;
    }
    return res;
  }
  throw new Error("Zu viele Redirects");
}
