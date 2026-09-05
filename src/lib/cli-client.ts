import { agentBeat, withAgentTimeout, AgentAbortError } from "./abort";
import { cliPrompt, parseCliChoice, type CliKind } from "./cli-protocol";
import type { LlmChoice } from "./agent-core";
export { CLI_PROVIDERS, cliKindFor, type CliKind } from "./cli-protocol";

export type CliStatus = {
  kind: CliKind;
  installed: boolean;
  authenticated: boolean | null;
  version: string;
};
type Reply = { ok: true; value: unknown } | { ok: false; error: string };
type Request = { id: string; kind: CliKind; model?: string; prompt?: string; timeoutMs?: number };
type Native = {
  cliProbe: (request: Request) => Promise<Reply>;
  cliLogin: (request: Request) => Promise<Reply>;
  cliRun: (request: Request) => Promise<Reply>;
  cliCancel: (id: string) => Promise<unknown>;
  onCliEvent: (id: string, fn: (e: { text?: string }) => void) => () => void;
};
function native(): Native | undefined {
  return typeof window === "undefined"
    ? undefined
    : (window as unknown as { anvilNative?: Native }).anvilNative;
}
export function hasCliNative() {
  return typeof native()?.cliRun === "function";
}

async function invoke(
  action: "cliProbe" | "cliLogin" | "cliRun",
  request: Omit<Request, "id">,
  signal?: AbortSignal,
  onOutput?: (text: string) => void,
): Promise<unknown> {
  const api = native();
  if (!api?.[action])
    throw new Error("Abo über CLI benötigt die Anvil-Desktop-App und eine installierte CLI.");
  if (signal?.aborted) throw new AgentAbortError();
  const id = crypto.randomUUID();
  const off = api.onCliEvent(id, (e) => {
    agentBeat();
    if (e.text) onOutput?.(e.text);
  });
  const abort = () => {
    void api.cliCancel(id).catch(() => undefined);
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const pending = api[action]({ ...request, id });
    if (signal?.aborted) abort();
    const r = await pending;
    if (signal?.aborted) throw new AgentAbortError();
    if (!r.ok) throw new Error(r.error);
    return r.value;
  } finally {
    off();
    signal?.removeEventListener("abort", abort);
  }
}

export async function probeCli(kind: CliKind, signal?: AbortSignal): Promise<CliStatus> {
  return (await invoke("cliProbe", { kind }, signal)) as CliStatus;
}
export async function loginCli(
  kind: CliKind,
  signal?: AbortSignal,
  onOutput?: (text: string) => void,
): Promise<CliStatus> {
  return (await invoke("cliLogin", { kind }, signal, onOutput)) as CliStatus;
}
export function cliStatusText(status: CliStatus): string {
  if (status.authenticated === false) return `${status.version} · Abo-Anmeldung fehlt`;
  if (status.authenticated === null)
    return `${status.version} · CLI vorhanden; Anmeldung wird beim Senden geprüft`;
  return `${status.version} · Abo angemeldet`;
}
export async function completeViaCli(
  kind: CliKind,
  model: string,
  messages: Record<string, unknown>[],
  tools: { function: { name: string } }[],
  timeoutMs = 0,
  onDelta?: (text: string, kind?: "text" | "think") => void,
): Promise<LlmChoice> {
  const raw = await invoke(
    "cliRun",
    { kind, model, prompt: cliPrompt(messages, tools), timeoutMs },
    withAgentTimeout(0),
  );
  const choice = parseCliChoice(
    String(raw),
    tools.map((t) => t.function.name),
  );
  if (choice.content) onDelta?.(choice.content, "text");
  return choice;
}
