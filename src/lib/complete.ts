import { completePrompt } from "@/lib/agent";
import { completeLocal, providerOf, type LlmProvider } from "@/lib/agent-client";

export async function completeText(opts: {
  prompt: string;
  provider: LlmProvider | string;
  baseUrl: string;
  model: string;
  apiKey: string;
  images?: string[];
}): Promise<string> {
  const id = providerOf(opts.provider).id;
  const pics = (opts.images ?? []).filter((u) => /^data:image\//i.test(u)).slice(0, 4);
  if (id === "grok") {
    const note = pics.length ? `\n\n(${pics.length} Bild(er) — Ask über Grok-complete ohne Vision; Agent-Modus sieht sie.)` : "";
    const r = await completePrompt({ data: { prompt: opts.prompt + note } });
    if (!r.ok) throw new Error(r.error || "Keine Antwort");
    return r.text;
  }
  return completeLocal(opts);
}

export function stripFence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  return m ? m[1] : t;
}
