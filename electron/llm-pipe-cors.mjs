export function pipeCorsOrigin(origin) {
  const raw = String(origin || "").trim();
  if (!raw) return "http://127.0.0.1:8080";
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    const h = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (h === "127.0.0.1" || h === "localhost" || h === "::1") return u.origin;
  } catch {
    /* */
  }
  return "";
}
