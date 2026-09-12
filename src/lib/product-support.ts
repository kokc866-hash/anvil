import { ANVIL_VERSION, ANVIL_BUILD } from "./version.ts";
import { PROVIDERS } from "./providers.ts";

/** Deliberate allowlist: no file contents, names, paths, URLs, chat, logs or keys. */
export function supportSummary(state: {
  llmProvider: string; llmAuthMode: string; files: Record<string, unknown>;
  dirty: Record<string, boolean>; agentBusy: boolean; running: boolean;
  workspaceCwd: string; locale: string;
}): string {
  return JSON.stringify({
    schema: 1, version: ANVIL_VERSION, build: ANVIL_BUILD,
    provider: PROVIDERS.find(p => p.id === state.llmProvider)?.id || "unknown",
    connection: state.llmAuthMode === "abo" ? "cli" : "api-or-server",
    locale: state.locale === "en" ? "en" : "de",
    projectFolderSelected: Boolean(state.workspaceCwd.trim()),
    files: Object.keys(state.files).length,
    unsavedFiles: Object.values(state.dirty).filter(Boolean).length,
    agentRunning: Boolean(state.agentBusy), programRunning: Boolean(state.running),
  }, null, 2);
}

export function supportDraft(summary: string, expected: string, actual: string, steps: string, en = false): string {
  return `${en ? "Anvil problem report" : "Anvil-Fehlerbericht"}\n\n${en ? "Expected" : "Erwartet"}: ${expected}\n\n${en ? "Actual" : "Tatsächlich"}: ${actual}\n\n${en ? "Steps to reproduce" : "Schritte zum Nachstellen"}:\n${steps}\n\n${en ? "Technical summary (no project contents)" : "Technische Zusammenfassung (ohne Projektinhalte)"}:\n${summary}`;
}
