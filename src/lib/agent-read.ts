import { toolResultFailed, toolResultPending } from "./agent-evidence.ts";
import { previewToolText, retainedToolPreview, type ToolOutputStore } from "./tool-output.ts";

export const READ_CHAR_CAP = 200_000;
export const READ_LINE_CAP = 2500;

export function readKey(path: string, startLine = 1): string {
  return `${path}:${Math.max(1, Math.floor(Number(startLine) || 1))}`;
}

export function readWindow(src: string, startLine = 1, endLine = 0): {
  body: string;
  from: number;
  to: number;
  total: number;
  truncated: boolean;
} {
  const lines = src.split("\n");
  const total = lines.length;
  const from = Math.max(1, Math.floor(startLine) || 1);
  let to = endLine >= from ? Math.min(total, Math.floor(endLine)) : total;
  if (!endLine && src.length > READ_CHAR_CAP) {
    to = Math.min(total, from + READ_LINE_CAP - 1);
  }
  let body = lines.slice(from - 1, to).join("\n");
  while (to > from && body.length > READ_CHAR_CAP) {
    to -= 1;
    body = lines.slice(from - 1, to).join("\n");
  }
  return { body, from, to, total, truncated: to < total };
}

export function packToolContent(name: string, result: unknown, outputs?: ToolOutputStore): string {
  if (name === "read_file" && result && typeof result === "object") {
    const r = result as {
      path?: string;
      content?: string;
      error?: string;
      truncated?: boolean;
      start_line?: number;
      end_line?: number;
      total_lines?: number;
      user_changes_protected?: boolean;
    };
    if (r.error) return JSON.stringify({ error: r.error, path: r.path });
    const numbered = String(r.content ?? "")
      .split("\n")
      .map((line, i) => `${String((r.start_line ?? 1) + i).padStart(5)}|${line}`)
      .join("\n");
    const head = `${r.path ?? ""}  Zeile ${r.start_line ?? 1}–${r.end_line ?? "?"} / ${r.total_lines ?? "?"}`;
    const more = r.truncated
      ? `\n\n[continue: read_file path="${r.path}" start_line=${(r.end_line ?? 0) + 1}]`
      : "";
    const protection=r.user_changes_protected?'\n[Concurrent user changes are protected. Preserve these lines; use edit_file only in unaffected areas.]':'';
    const out = `${head}${protection}\n${numbered}${more}`;
    return out.length > READ_CHAR_CAP + 4000 ? `${out.slice(0, READ_CHAR_CAP)}\n\n[continue: start_line]` : out;
  }
  if (name === "write_file" && result && typeof result === "object") {
    const r = result as { path?: string; truncated?: boolean; bytes?: number; error?: string; hint?: string };
    if (r.truncated) {
      return JSON.stringify({
        ok: true,
        path: r.path,
        bytes: r.bytes,
        truncated: true,
        hint: r.hint || "truncated — edit_file at the end, do not rewrite",
      });
    }
  }
  const raw = JSON.stringify(result ?? {});
  if (name === "run_file" && result && typeof result === "object") {
    const r = result as Record<string, unknown> & { stdout?: string; stderr?: string; hint?: string };
    const cancelled = Boolean(r.aborted || r.cancelled || r.canceled || r.interrupted || /^(aborted|interrupted|cancelled|canceled)$/i.test(String(r.status || "")));
    const status = cancelled ? "CANCELLED" : toolResultFailed(r) ? "FAIL" : toolResultPending(r) ? "PENDING" : r.ok === true || r.code === 0 || r.exitExpectationMatched === true ? "OK" : "UNKNOWN";
    const bits = [
      `RUN ${status}`,
      typeof r.code === "number" ? `Exit code: ${r.code}${r.exitExpectationMatched === true ? " (explicit expected exit matched)" : ""}` : "",
      r.stdout?.trim(),
      r.stderr?.trim() ? `stderr:\n${r.stderr}` : "",
      r.error ? String(r.error) : "",
      r.hint,
      typeof r.note==='string'?previewToolText(r.note,1200):'',
    ].filter(Boolean);
    const stage=r.stage && typeof r.stage==='object'?r.stage as Record<string,unknown>:undefined;
    const observation=r.observation && typeof r.observation==='object'?r.observation as Record<string,unknown>
      : r.state && typeof r.state==='object'?r.state as Record<string,unknown>:undefined;
    if((stage?.kind==='html' || r.graphical===true) && observation && Array.isArray(observation.elements)) {
      bits.push('HTML preview controls (CSS pixels):\n'+JSON.stringify({viewport:observation.viewport,elements:observation.elements}));
      if(Array.isArray(observation.observations)) bits.push('Observed output targets for assertions (observed values are not automatically expected results):\n'+JSON.stringify({observations:observation.observations,observationsTruncated:observation.observationsTruncated}));
    }
    if(r.testing&&typeof r.testing==='object')bits.push('Next preview check (not performed):\n'+JSON.stringify(r.testing));
    const text = bits.join("\n\n");
    if (text.length <= 16000) return text;
    const envelope = retainedToolPreview(raw, result, 14000, outputs);
    const note = `\n\n[tool output truncated; retained=${envelope.retained}${envelope.outputId ? `; outputId=${envelope.outputId}` : ""}]\n${envelope.hint}`;
    return previewToolText(text, 16000 - note.length) + note;
  }
  if (raw.length <= 80_000) return raw;
  const envelope = retainedToolPreview(raw, result, 78000, outputs);
  let packed = JSON.stringify(envelope), previewCap = 78000;
  while (packed.length > 80000 && previewCap > 0) {
    previewCap = Math.max(0, previewCap - (packed.length - 80000) - 128);
    envelope.text = previewToolText(raw, previewCap);
    packed = JSON.stringify(envelope);
  }
  return packed;
}

/** Keep structured tool results machine-readable when attaching plan references. */
export function packToolEvidence(name: string, result: unknown, evidenceId?: string, outputs?: ToolOutputStore): string {
  const content = packToolContent(name, result, outputs);
  if (!evidenceId) return content;
  try {
    const value = JSON.parse(content);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return JSON.stringify({ ...value, plan_evidence_id: evidenceId });
    }
  } catch { /* Read windows and run output intentionally use plain text. */ }
  return `Plan evidence ID: ${evidenceId} (use only if this result supports the step; a running check is not complete).\n${content}`;
}
