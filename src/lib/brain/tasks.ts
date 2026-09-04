import { useLearn } from "@/lib/learn";
import { useIde } from "@/store/ide";
import { expandIntent, heuristicPalette, heuristicUsageFacts } from "./heuristics";
import { brainGenerate, brainSystem, extractJson, firstUsefulLine } from "./engine";
import { brainReady, useBrain } from "./store";

const KINDS = ["agent", "run", "debug", "search", "git", "settings", "preview", "learn", "file", "output", "save", "help", "newfile"] as const;
export type IntentKind = (typeof KINDS)[number];

export type BrainIntent = {
  kind: IntentKind;
  path?: string;
  query?: string;
  conf: number;
};

const HELP: Record<string, string> = {
  helfer: "Einstellungen → Helfer. Optional, lokal. Kurzbefehle, nicht der Agent.",
  gehirn: "Heißt jetzt Helfer. Einstellungen → Helfer. Das Denken übernimmt das Hauptmodell unter Agent.",
  debug: "F5 starten, F9 Breakpoint, F10 Schritt, Shift+F5 stoppen. Ausgabe zeigt lokale Variablen.",
  agent: "Ctrl+L. Ask erklärt, Agent schreibt Dateien. Modell unter Einstellungen → Agent.",
  run: "Ctrl+Enter oder Run. HTML öffnet das Run-Fenster. Godot/Unity: Companion in den Einstellungen.",
  engine: "Einstellungen → Agent → Companion. Auf dem Rechner: node companion/server.mjs. Dann engine_run oder MCP.",
  git: "Activity-Leiste: Git. Commit lokal, Push braucht GitHub in den Einstellungen.",
  datei: "Ctrl+P öffnet Dateien. Explorer links, Rechtsklick für neu oder umbenennen.",
  speicher: "Einstellungen → Speicher. Browser oder Ordner auf der Platte.",
  gedächtnis: "Activity → Gedächtnis. Person, Projekt, Sitzung, Skills. Die Sitzung überlebt Compacting.",
  ausgabe: "Ctrl+J, Activity: Ausgabe. Auch als Fenster oder Seite.",
};

function helpFor(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/[!?]+$/, "");
  const words = t.split(/\s+/);
  if (words.length > 8) return null;
  const asked = /^(wo|wie|was|hilf|help|erkläre)\b/.test(t);
  const exact = words.length <= 2;
  if (!asked && !exact) return null;
  for (const [k, v] of Object.entries(HELP)) {
    const hit = (exact && (t === k || t === `${k}?`)) || (asked && new RegExp(`\\b${k}\\b`).test(t));
    if (hit) return v;
  }
  if (asked && t.length < 40) {
    return "Activity links: Dateien, Suche, Git, Erweiterungen, Gedächtnis. Einstellungen unten. Agent rechts.";
  }
  return null;
}

export function heuristicIntent(text: string): BrainIntent {
  const extra = expandIntent(text);
  if (extra && extra.conf >= 0.9 && KINDS.includes(extra.kind as IntentKind)) {
    return extra as BrainIntent;
  }
  const t = text.trim().toLowerCase().replace(/[!?]+$/, "");
  if (useBrain.getState().jobs.help) {
    const help = helpFor(t);
    if (help) return { kind: "help", query: help, conf: 0.95 };
  }
  if (t.split(/\s+/).length > 6 || t.length > 80) return { kind: "agent", conf: 0.2 };
  if (/^(run|ausführen|starten)$/.test(t)) return { kind: "run", conf: 0.96 };
  if (/^(debug(gen)?|schritt)$/.test(t)) return { kind: "debug", conf: 0.95 };
  if (/^(suche|find|grep)\s+\S+/.test(t)) return { kind: "search", query: t.replace(/^(suche|find|grep)\s+/, ""), conf: 0.93 };
  if (/^(git|status|push)$/.test(t)) return { kind: "git", conf: 0.94 };
  if (/^(einstellungen|settings)$/.test(t)) return { kind: "settings", conf: 0.95 };
  if (/^(vorschau|preview)$/.test(t)) return { kind: "preview", conf: 0.94 };
  if (/^(gedächtnis|memory)$/.test(t)) return { kind: "learn", conf: 0.94 };
  if (/^(ausgabe|output)$/.test(t)) return { kind: "output", conf: 0.94 };
  if (/^(speichern|save)$/.test(t)) return { kind: "save", conf: 0.94 };
  if (/^(neue datei|new file)$/.test(t)) return { kind: "newfile", conf: 0.94 };
  if (/^(öffne|open)\s+\S+\.\w+$/.test(t)) {
    return { kind: "file", path: text.trim().split(/\s+/).slice(1).join(" "), conf: 0.9 };
  }
  return { kind: "agent", conf: 0.25 };
}

export async function resolveIntent(text: string): Promise<BrainIntent> {
  const h = heuristicIntent(text);
  if (h.conf >= 0.9) return h;
  if (h.kind === "agent" && text.trim().split(/\s+/).length > 4) return { kind: "agent", conf: 0.2 };
  if (!brainReady() || !useBrain.getState().jobs.intent) return { kind: "agent", conf: 0.2 };
  if (text.trim().length > 40) return { kind: "agent", conf: 0.2 };
  try {
    const raw = await Promise.race([
      brainGenerate({
        messages: [
          { role: "system", content: brainSystem("intent JSON. One object, nothing else.") },
          {
            role: "user",
            content: `kind nur: ${KINDS.join("|")}. Unsicher = agent. JSON: {"kind":"agent","conf":0.2}\nText: ${text}`,
          },
        ],
        maxTokens: 48,
        temperature: 0,
        json: true,
        stop: ["\n\n"],
        pri: 0,
        job: "intent",
      }),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error("intent-timeout")), 700)),
    ]);
    const j = extractJson(raw) as BrainIntent | null;
    if (!j || !KINDS.includes(j.kind as IntentKind)) return { kind: "agent", conf: 0.2 };
    if (j.kind === "help") {
      const msg = helpFor(text);
      return msg ? { kind: "help", query: msg, conf: 0.9 } : { kind: "agent", conf: 0.2 };
    }
    const conf = Math.min(0.95, Number(j.conf) || 0);
    if (conf < 0.8) return { kind: "agent", conf: 0.2 };
    return { kind: j.kind, path: j.path, query: j.query, conf };
  } catch {
    return { kind: "agent", conf: 0.2 };
  }
}

export function applyIntent(it: BrainIntent): string {
  const ide = useIde.getState();
  if (it.kind === "run") return "Ausführen: Ctrl+Enter oder Run.";
  if (it.kind === "debug") return "Debugger: F5.";
  if (it.kind === "search") {
    ide.setSidebar("search");
    if (it.query) ide.setSearchQuery(it.query);
    return it.query ? `Suche: ${it.query}` : "Suche.";
  }
  if (it.kind === "git") {
    ide.setSidebar("git");
    return "Quelle.";
  }
  if (it.kind === "settings") {
    ide.setSettingsOpen(true);
    return "Einstellungen.";
  }
  if (it.kind === "preview") {
    ide.setPreviewOpen(true);
    return "Vorschau.";
  }
  if (it.kind === "learn") {
    ide.setSidebar("learn");
    return "Gedächtnis.";
  }
  if (it.kind === "output") {
    ide.revealOutput();
    return "Ausgabe.";
  }
  if (it.kind === "save") return "Speichern: Ctrl+S.";
  if (it.kind === "newfile") {
    ide.setSidebar("files");
    return "Neue Datei: Explorer.";
  }
  if (it.kind === "help") return it.query || HELP.helfer;
  if (it.kind === "file" && it.path) {
    const hit = Object.keys(ide.files).find((p) => p.endsWith(it.path!) || p.includes(it.path!));
    if (hit) {
      ide.openFile(hit);
      return `Öffne ${hit}`;
    }
  }
  return "";
}

function validFact(text: string) {
  const t = text.trim();
  if (t.length < 8 || t.length > 160) return false;
  if ((t.match(/[{};=]/g) ?? []).length > 6) return false;
  if (/api[_-]?key|token|password|secret/i.test(t)) return false;
  if (/^(ich denke|vielleicht|als ki|hier ist)/i.test(t)) return false;
  return true;
}

export async function brainDistill(user: string, reply: string): Promise<void> {
  if (!useBrain.getState().on || !useBrain.getState().jobs.distill) return;
  if (!brainReady()) return;
  try {
    const raw = await brainGenerate({
      messages: [
        { role: "system", content: brainSystem("JSON facts only. Max 2. Durable, concrete.") },
        {
          role: "user",
          content: `{"facts":[{"kind":"user"|"project"|"lesson","text":"..."}]}\nLeer: {"facts":[]}\nUser: ${user.slice(0, 500)}\nAssist: ${reply.slice(0, 400)}`,
        },
      ],
      maxTokens: 120,
      temperature: 0,
      json: true,
      stop: ["\n\n\n"],
      pri: 2,
      job: "distill",
    });
    const j = extractJson(raw) as { facts?: { kind?: string; text?: string }[] } | null;
    if (!j?.facts?.length) return;
    const learn = useLearn.getState();
    for (const f of j.facts.slice(0, 2)) {
      if (!f.text || !validFact(f.text)) continue;
      const kind = f.kind === "project" || f.kind === "user" || f.kind === "lesson" ? f.kind : "lesson";
      learn.addFact(kind, f.text, 0.68);
    }
  } catch {
    /* stay silent */
  }
}

export async function brainUsage(): Promise<void> {
  if (!useBrain.getState().jobs.usage) return;
  if (brainReady()) {
    const ev = useLearn.getState().events.slice(0, 24);
    if (ev.length < 8) return;
    const blob = ev.map((e) => `${e.k}${e.d ? `:${e.d}` : ""}`).join(" | ");
    try {
      const raw = await brainGenerate({
        messages: [
          { role: "system", content: brainSystem("IDE use in 1 fact, or {\"facts\":[]}. JSON only.") },
          {
            role: "user",
            content: `Events (neu zuerst): ${blob.slice(0, 900)}\nJSON: {"facts":[{"kind":"user","text":"..."}]} nur wenn ein klares Muster da ist.`,
          },
        ],
        maxTokens: 100,
        temperature: 0,
        json: true,
        pri: 2,
        job: "usage",
      });
      const j = extractJson(raw) as { facts?: { kind?: string; text?: string }[] } | null;
      const learn = useLearn.getState();
      for (const f of j?.facts ?? []) {
        if (f.text && validFact(f.text)) learn.addFact(f.kind === "project" ? "project" : "user", f.text, 0.6);
      }
      return;
    } catch {
      /* fallback */
    }
  }
  const heur = heuristicUsageFacts();
  if (heur.length) {
    const learn = useLearn.getState();
    for (const f of heur) learn.addFact(f.kind, f.text, 0.55);
    useBrain.getState().logJob("usage", "heur", 0);
  }
}

export async function brainCompleteCode(opts: { lang: string; prefix: string; before: string }): Promise<string> {
  if (!brainReady() || !useBrain.getState().jobs.complete) return "";
  if (opts.prefix.length < 3) return "";
  const raw = await brainGenerate({
    messages: [
      { role: "system", content: brainSystem("Only the rest after the prefix. One line, no markdown, no explanation.") },
      { role: "user", content: `${opts.lang}\n${opts.before.slice(-400)}\n${opts.prefix}` },
    ],
    maxTokens: 28,
    temperature: 0.1,
    stop: ["\n", "```"],
    pri: 0,
    job: "complete",
  });
  let line = firstUsefulLine(raw, 72);
  if (line.toLowerCase().startsWith(opts.prefix.toLowerCase())) line = line.slice(opts.prefix.length);
  if (!line || /https?:|als ki|hier ist/i.test(line)) return "";
  return line;
}

export async function brainPalette(q: string, labels: string[]): Promise<string | null> {
  if (!brainReady() || !useBrain.getState().jobs.palette || q.trim().length < 3) return null;
  const h = heuristicPalette(q, labels);
  if (h) {
    useBrain.getState().logJob("palette", "heur", 0);
    return h;
  }
  const raw = await brainGenerate({
    messages: [
      { role: "system", content: brainSystem("One label from the list or NO. Nothing else.") },
      { role: "user", content: `${q}\n${labels.slice(0, 30).join(" | ")}` },
    ],
    maxTokens: 20,
    temperature: 0,
    stop: ["\n"],
    pri: 0,
    job: "palette",
  });
  const t = firstUsefulLine(raw, 40);
  if (!t || /^nein/i.test(t)) return null;
  return labels.find((l) => l.toLowerCase() === t.toLowerCase()) ?? null;
}

export async function brainCompact(blob: string): Promise<string> {
  const cut = blob.slice(0, 8000);
  if (!brainReady() || !useBrain.getState().jobs.compact) return cut;
  try {
    const raw = await brainGenerate({
      messages: [
        {
          role: "system",
          content: brainSystem(
            "Up to 12 bullets. Keep: goal, file paths, user constraints, leftover work. Source language. No preamble.",
          ),
        },
        { role: "user", content: cut },
      ],
      maxTokens: Math.min(700, useBrain.getState().maxTokens),
      temperature: 0.1,
      stop: ["\n\n\n"],
      pri: 2,
      job: "compact",
    });
    const clean = raw
      .split("\n")
      .filter((l) => l.trim() && !/^(zusammenfassung|hier|sicher)/i.test(l))
      .slice(0, 14)
      .join("\n");
    return clean || cut;
  } catch {
    return cut;
  }
}

export async function brainAsk(prompt: string, onDelta?: (s: string) => void): Promise<string> {
  if (!brainReady() || !useBrain.getState().jobs.ask) throw new Error("Ask lokal aus");
  if (useBrain.getState().jobs.help) {
    const h = helpFor(prompt);
    if (h && prompt.length < 100) {
      onDelta?.(h);
      return h;
    }
  }
  const st = useBrain.getState();
  const raw = await brainGenerate({
    messages: [
      { role: "system", content: brainSystem("Max 5 short sentences. Do not invent files. No code except 1 line if asked.") },
      { role: "user", content: prompt.slice(0, 2000) },
    ],
    maxTokens: st.maxTokens,
    temperature: st.temperature,
    stop: ["\n\n\n"],
    job: "ask",
    onDelta,
  });
  return raw.split("\n").slice(0, 8).join("\n");
}
