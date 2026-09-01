export type PatchPlan = {
  write: Record<string, string>;
  del: string[];
  note: string;
  errors: string[];
};

function cleanPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^a\//, "").replace(/^b\//, "");
}

export function parsePatch(text: string, files: Record<string, string> = {}): PatchPlan {
  const raw = text.replace(/^\uFEFF/, "");
  const t = raw.trim();
  if (t.startsWith("{")) return parseJson(t);
  if (/^ANVIL-PATCH\b/i.test(t)) return parseAnvil(raw);
  if (/^diff --git |^--- /m.test(t)) return parseUnified(raw, files);
  return { write: {}, del: [], note: "", errors: ["Kein Patch erkannt. JSON, ANVIL-PATCH oder unified diff."] };
}

function parseJson(t: string): PatchPlan {
  try {
    const j = JSON.parse(t) as { v?: number; note?: string; files?: Record<string, string>; delete?: string[] };
    const write: Record<string, string> = {};
    for (const [p, c] of Object.entries(j.files ?? {})) {
      if (typeof c === "string" && p.trim()) write[cleanPath(p)] = c;
    }
    return {
      write,
      del: (j.delete ?? []).map(cleanPath).filter(Boolean),
      note: String(j.note ?? ""),
      errors: Object.keys(write).length || (j.delete ?? []).length ? [] : ["Patch leer"],
    };
  } catch (e) {
    return { write: {}, del: [], note: "", errors: [e instanceof Error ? e.message : "JSON unlesbar"] };
  }
}

function parseAnvil(raw: string): PatchPlan {
  const write: Record<string, string> = {};
  const del: string[] = [];
  const errors: string[] = [];
  let note = "";
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  if (lines[0]?.startsWith("ANVIL-PATCH")) i = 1;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.startsWith("#")) {
      i += 1;
      continue;
    }
    if (line.startsWith("NOTE ")) {
      note = line.slice(5).trim();
      i += 1;
      continue;
    }
    if (line.startsWith("DELETE ")) {
      del.push(cleanPath(line.slice(7).trim()));
      i += 1;
      continue;
    }
    const fm = line.match(/^FILE\s+(\S+)\s*(<<(\S+))?$/);
    if (fm) {
      const path = cleanPath(fm[1]);
      const fence = fm[3] || "ANVIL";
      i += 1;
      const body: string[] = [];
      while (i < lines.length && lines[i] !== fence) {
        body.push(lines[i]);
        i += 1;
      }
      if (i >= lines.length) errors.push(`${path}: Ende ${fence} fehlt`);
      else i += 1;
      write[path] = body.join("\n");
      if (write[path].length && !write[path].endsWith("\n")) write[path] += "\n";
      continue;
    }
    errors.push(`Zeile ${i + 1}: ${line.slice(0, 60)}`);
    i += 1;
  }
  return { write, del, note, errors };
}

function parseUnified(raw: string, files: Record<string, string>): PatchPlan {
  const write: Record<string, string> = {};
  const del: string[] = [];
  const errors: string[] = [];
  const blocks = raw.replace(/\r\n/g, "\n").split(/^diff --git /m);
  const chunks = blocks[0].startsWith("--- ") ? [raw.replace(/\r\n/g, "\n")] : blocks.slice(1).map((b) => `diff --git ${b}`);
  if (!chunks.length && /^--- /m.test(raw)) chunks.push(raw.replace(/\r\n/g, "\n"));
  for (const chunk of chunks) {
    const minus = chunk.match(/^---\s+(\S+)/m)?.[1];
    const plus = chunk.match(/^\+\+\+\s+(\S+)/m)?.[1];
    if (!minus || !plus) continue;
    const oldPath = minus === "/dev/null" ? "" : cleanPath(minus);
    const newPath = plus === "/dev/null" ? "" : cleanPath(plus);
    if (!newPath) {
      if (oldPath) del.push(oldPath);
      continue;
    }
    const body = applyHunks(chunk, files[oldPath] || files[newPath] || "");
    if (body.error) {
      errors.push(`${newPath}: ${body.error}`);
      continue;
    }
    write[newPath] = body.text;
    if (oldPath && oldPath !== newPath) del.push(oldPath);
  }
  return { write, del, note: "", errors };
}

function applyHunks(chunk: string, base: string): { text: string; error?: string } {
  const hunks = [...chunk.matchAll(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@.*\n((?:[ +\-\\].*\n)*)/gm)];
  if (!hunks.length) {
    if (/^new file/m.test(chunk) || /--- \/dev\/null/.test(chunk)) {
      const lines = chunk.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
      return { text: lines.map((l) => l.slice(1)).join("\n") + (lines.length ? "\n" : "") };
    }
    return { text: base, error: "keine Hunks" };
  }
  const src = base ? base.split("\n") : [];
  if (src.length && src[src.length - 1] === "") src.pop();
  const out: string[] = [];
  let cursor = 0;
  for (const h of hunks) {
    const oldStart = Math.max(1, Number(h[1])) - 1;
    const body = h[5] ?? "";
    while (cursor < oldStart && cursor < src.length) {
      out.push(src[cursor]);
      cursor += 1;
    }
    for (const line of body.split("\n")) {
      if (!line) continue;
      const tag = line[0];
      const rest = line.slice(1);
      if (tag === " " || tag === "+") out.push(rest);
      if (tag === " " || tag === "-") cursor += 1;
    }
  }
  while (cursor < src.length) {
    out.push(src[cursor]);
    cursor += 1;
  }
  return { text: out.join("\n") + (out.length ? "\n" : "") };
}

export function applyPatchToFiles(files: Record<string, string>, plan: PatchPlan): Record<string, string> {
  const next = { ...files };
  for (const p of plan.del) delete next[p];
  Object.assign(next, plan.write);
  return next;
}

export function patchSummary(plan: PatchPlan): string {
  const n = Object.keys(plan.write).length;
  const d = plan.del.length;
  const bits = [`${n} Datei${n === 1 ? "" : "en"}`];
  if (d) bits.push(`${d} gelöscht`);
  if (plan.note) bits.unshift(plan.note);
  if (plan.errors.length) bits.push(`${plan.errors.length} Fehler`);
  return bits.join(" · ");
}

export async function commitPatch(plan: PatchPlan): Promise<string> {
  const { useIde } = await import("@/store/ide");
  const st = useIde.getState();
  for (const p of plan.del) st.deleteFile(p);
  for (const [p, c] of Object.entries(plan.write)) st.writeFile(p, c);
  const msg = patchSummary(plan);
  st.setNotice(msg);
  return msg;
}

