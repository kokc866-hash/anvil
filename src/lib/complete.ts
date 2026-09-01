import { completePrompt } from "@/lib/agent";
import { completeLocal, providerOf, type LlmProvider } from "@/lib/agent-client";

export async function completeText(opts: {
  prompt: string;
  provider: LlmProvider | string;
  baseUrl: string;
  model: string;
  apiKey: string;
}): Promise<string> {
  const id = providerOf(opts.provider).id;
  if (id === "grok") {
    const r = await completePrompt({ data: { prompt: opts.prompt } });
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
