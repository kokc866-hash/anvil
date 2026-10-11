import { resolvedUsage, type TokenUsage, type RequestTokens } from "./token-usage";
import { completePrompt } from "@/lib/agent";
import { completeLocal, providerOf, type LlmProvider } from "@/lib/agent-client";
import { captureAgentRun, bindAgentRun, type AgentRun } from "./agent-run";

export async function completeText(opts: {
  prompt: string;
  run?: AgentRun;
  provider: LlmProvider | string;
  baseUrl: string;
  model: string;
  apiKey: string;
  images?: string[];
  onUsage?: (usage: TokenUsage, request?: RequestTokens) => void;
}): Promise<string> {
  const run = opts.run ?? captureAgentRun();
  run.assertCurrent();
  opts = bindAgentRun(run, { ...opts, run });
  const id = providerOf(opts.provider).id;
  const pics = (opts.images ?? []).filter((u) => /^data:image\//i.test(u)).slice(0, 4);
  if (id === "grok") {
    const note = pics.length ? `\n\n(${pics.length} Bild(er) — Ask über Grok-complete ohne Vision; Agent-Modus sieht sie.)` : "";
    const r = await run.wait(completePrompt({ data: { prompt: opts.prompt + note }, signal: run.signal }));
    if (!r.ok) throw new Error(r.error || "Keine Antwort");
    opts.onUsage?.(resolvedUsage({ content: r.text, usage: r.usage, requestTokens: r.requestTokens }, [{ role: "user", content: opts.prompt + note }]), r.requestTokens);
    return r.text;
  }
  return run.wait(completeLocal(opts));
}

export function stripFence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  return m ? m[1] : t;
}
