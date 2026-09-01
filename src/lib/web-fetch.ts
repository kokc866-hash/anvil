import { createServerFn } from "@tanstack/react-start";
import { sameOriginMiddleware } from "@/lib/auth/middleware";
import { fetchPublic, isPrivateHost } from "./net-guard";

export { isPrivateHost };

export async function readWebPage(urlRaw: string): Promise<{ ok: boolean; text: string; status?: number }> {
  try {
    const res = await fetchPublic(urlRaw, {
      headers: { Accept: "text/plain, text/html, application/json, */*;q=0.8" },
    });
    const raw = await res.text();
    const cut = raw.slice(0, 20_000);
    const text = stripHtml(cut);
    if (!res.ok) return { ok: false, text: `HTTP ${res.status}: ${text.slice(0, 400)}`, status: res.status };
    return { ok: true, text, status: res.status };
  } catch (err) {
    return { ok: false, text: err instanceof Error ? err.message : String(err) };
  }
}

function stripHtml(html: string): string {
  if (!/<[a-z][\s\S]*>/i.test(html)) return html;
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export const fetchWeb = createServerFn({ method: "POST" })
  .middleware([sameOriginMiddleware])
  .validator((input: { url: string }) => input)
  .handler(async ({ data }) => readWebPage(data.url));
