type Tool = { name: string; ok: boolean; error?: string; status?: "passed" | "findings" | "failed" };

export function lintSummary(tools: Tool[], count: number): { ok: boolean; text: string } {
  const failed = tools.filter((tool) => tool.error || tool.status === "failed" || (!tool.status && !tool.ok));
  if (failed.length) return {
    ok: false,
    text: `${failed.map((tool) => `${tool.name}: ${tool.error || (tool.status === "failed" ? "Prüfung fehlgeschlagen" : "Prüfstatus unklar (ältere Verbindung)")}`).join(", ")} · ${count} Code-Meldungen insgesamt`,
  };
  return { ok: true, text: `Prüfung abgeschlossen · ${count} Code-Meldungen${tools.length ? ` · ${[...new Set(tools.map((tool) => tool.name))].join(", ")}` : ""}` };
}
