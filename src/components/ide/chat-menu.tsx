import { runFile } from "@/lib/run-client";

import { isSecretPath, REF_DIR, safeRefName } from "@/lib/ref";

import { stopAgent } from "@/lib/abort";

import { nativeHelper } from "@/lib/helper-local";
import { useIde, type ChatMsg } from "@/store/ide";

import { t } from "@/lib/i18n";
import { uniqueDest } from "@/lib/dnd";
import { type CtxItem } from "./ctx-menu";

import { parseBlocks } from "@/lib/chat-content";
export type ChatMenu =
  | { kind: "msg"; x: number; y: number; id: string }
  | { kind: "pane"; x: number; y: number }
  | { kind: "code"; x: number; y: number; path: string; lang: string; text: string };

function trailText(m: ChatMsg): string {
  const steps = (m.steps ?? []).map((s) => `${s.status} ${s.name} ${s.detail}`.trim()).join("\n");
  const run = m.lastRun ? `run ${m.lastRun.ok ? "ok" : "fail"} ${m.lastRun.path}\n${m.lastRun.stdout}\n${m.lastRun.stderr}` : "";
  return [steps, run].filter(Boolean).join("\n\n");
}

function applyCodeBlocks(text: string): number {
  const st = useIde.getState();
  let n = 0;
  for (const p of parseBlocks(text)) {
    if (!p.code || !p.text.trim()) continue;
    const path =
      p.path || uniqueDest(st.files, "", /\bpy/.test(p.lang) ? "snippet.py" : /\bts/.test(p.lang) ? "snippet.ts" : "snippet.js");
    st.writeFile(path, p.text);
    n += 1;
  }
  st.setNotice(n ? `${n} Dateien` : t("roundNone"));
  return n;
}

function saveRef(name: string, content: string, mode: "write" | "append" = "write") {
  const st = useIde.getState();
  const rel = safeRefName(name);
  const path = `${REF_DIR}/${rel}`;
  if (isSecretPath(path)) {
    st.setNotice("Geheimnis bleibt außerhalb von ref/");
    return;
  }
  const body = content.endsWith("\n") ? content : `${content}\n`;
  const prev = st.files[path] ?? "";
  if (mode === "append" && prev) st.writeFile(path, `${prev.replace(/\s*$/, "\n\n")}${body}`);
  else st.writeFile(path, body);
  st.setNotice(path);
}

function transcript(): string {
  return useIde
    .getState()
    .chat.map((m) => `## ${m.role}\n\n${m.content.trim()}`)
    .join("\n\n");
}

export const chatSel = { a: 0, b: 0 };

function insertDraft(text: string) {
  const st = useIde.getState();
  const cur = st.agentDraft;
  const el = document.getElementById("anvil-chat") as HTMLTextAreaElement | null;
  const a = Math.min(chatSel.a, cur.length);
  const b = Math.min(chatSel.b, cur.length);
  const next = `${cur.slice(0, a)}${text}${cur.slice(b)}`;
  st.setAgentDraft(next);
  requestAnimationFrame(() => {
    if (!el) return;
    el.focus();
    const n = a + text.length;
    el.setSelectionRange(n, n);
    chatSel.a = n;
    chatSel.b = n;
  });
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("lesen"));
    r.readAsDataURL(blob);
  });
}

async function readChatClipboard(): Promise<{ text: string; images: string[] }> {
  const native = nativeHelper();
  if (native?.clipboardRead) {
    const r = await native.clipboardRead();
    return { text: r.text || "", images: r.image ? [r.image] : [] };
  }
  const images: string[] = [];
  let text = "";
  try {
    if (navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith("image/")) images.push(await blobDataUrl(await item.getType(type)));
          else if (type === "text/plain" && !text) text = await (await item.getType(type)).text();
        }
      }
    }
  } catch {
    /* */
  }
  if (!text) {
    try {
      text = await navigator.clipboard.readText();
    } catch {
      /* */
    }
  }
  return { text, images: images.filter(Boolean).slice(0, 4) };
}

async function pasteIntoChat(addImages: (urls: string[]) => void) {
  const st = useIde.getState();
  try {
    const { text, images } = await readChatClipboard();
    if (images.length) addImages(images);
    if (text) insertDraft(text);
    if (!text && !images.length) st.setNotice("Ablage leer");
  } catch {
    st.setNotice("Ablage nicht lesbar");
  }
}

export function chatMenu(menu: ChatMenu, extra?: { addImages: (urls: string[]) => void }): CtxItem[] {
  const st = useIde.getState();
  if (menu.kind === "pane") {
    const items: CtxItem[] = [
      {
        label: t("newChat"),
        onClick: () => {
          stopAgent("Neuer Chat");
          st.clearChat();
        },
      },
      { label: t("ask"), onClick: () => st.setAgentMode("ask") },
      { label: t("agent"), onClick: () => st.setAgentMode("agent") },
      { sep: true, label: "" },
      { label: t("chatPaste"), onClick: () => void pasteIntoChat(extra?.addImages ?? (() => {})) },
      { label: t("attachImage"), onClick: () => document.getElementById("anvil-chat-img")?.click() },
      { sep: true, label: "" },
      { label: t("chatTranscript"), onClick: () => void navigator.clipboard.writeText(transcript()) },
      { label: t("chatExport"), onClick: () => saveRef("chat.md", transcript(), "append") },
    ];
    if (st.agentBusy) {
      items.push({
        label: t("stop"),
        danger: true,
        onClick: () => stopAgent("Gestoppt"),
      });
    }
    return items;
  }
  if (menu.kind === "code") {
    const path = menu.path;
    const guess =
      path ||
      uniqueDest(st.files, "", /\bpy/.test(menu.lang) ? "snippet.py" : /\bts/.test(menu.lang) ? "snippet.ts" : "snippet.js");
    return [
      { label: t("copy"), onClick: () => void navigator.clipboard.writeText(menu.text) },
      {
        label: path || t("chatSaveAs"),
        onClick: () => {
          st.writeFile(guess, menu.text);
          st.openFile(guess);
        },
      },
      {
        label: t("chatInsertAt"),
        disabled: !st.activePath,
        onClick: () => {
          const p = st.activePath;
          if (!p) return;
          const cur = st.files[p] ?? "";
          st.setContent(p, cur ? `${cur.replace(/\s*$/, "")}\n\n${menu.text}\n` : `${menu.text}\n`);
        },
      },
      {
        label: t("chatRunCode"),
        onClick: () => {
          const p = path && path in st.files ? path : guess;
          if (!(p in useIde.getState().files) || path !== p) useIde.getState().writeFile(p, menu.text);
          useIde.getState().setRunPath(p);
          void runFile(p, useIde.getState().files).then((r) => {
            useIde.getState().pushOutput(r);
            useIde.getState().revealOutput();
          });
        },
      },
      { sep: true, label: "" },
      {
        label: t("chatAskCode"),
        onClick: () => {
          st.setAgentMode("ask");
          st.pushAgent(`Erkläre diesen Code${path ? ` (${path})` : ""}:\n\`\`\`\n${menu.text.slice(0, 4000)}\n\`\`\``);
        },
      },
      {
        label: t("chatFixCode"),
        onClick: () => {
          st.setAgentMode("agent");
          st.pushAgent(
            `Diesen Code nachbessern, lauffähig machen${path ? `, Datei ${path}` : ""}:\n\`\`\`\n${menu.text.slice(0, 4000)}\n\`\`\``,
          );
        },
      },
    ];
  }
  const m = st.chat.find((x) => x.id === menu.id);
  if (!m) return [];
  const items: CtxItem[] = [
    { label: t("copy"), onClick: () => void navigator.clipboard.writeText(m.content) },
    { label: t("chatCopyMd"), onClick: () => void navigator.clipboard.writeText(`## ${m.role}\n\n${m.content}`) },
  ];
  if (m.thinking) {
    items.push({ label: t("chatCopyThink"), onClick: () => void navigator.clipboard.writeText(m.thinking ?? "") });
  }
  if (m.steps?.length || m.lastRun) {
    items.push({ label: t("chatCopyTrail"), onClick: () => void navigator.clipboard.writeText(trailText(m)) });
  }
  items.push({ sep: true, label: "" });
  if (m.role === "user") {
    items.push(
      { label: t("chatEdit"), onClick: () => st.setAgentDraft(m.content) },
      { label: t("chatQuote"), onClick: () => st.setAgentDraft(`> ${m.content.slice(0, 800)}\n\n${st.agentDraft}`) },
      { label: t("again"), onClick: () => st.pushAgent(m.content) },
      {
        label: t("chatAskThis"),
        onClick: () => {
          st.setAgentMode("ask");
          st.pushAgent(m.content);
        },
      },
      {
        label: t("chatAgentThis"),
        onClick: () => {
          st.setAgentMode("agent");
          st.pushAgent(m.content);
        },
      },
    );
  } else {
    const prev = [...st.chat].reverse().find((x) => x.role === "user" && st.chat.indexOf(x) < st.chat.indexOf(m));
    items.push(
      { label: t("again"), disabled: !prev, onClick: () => prev && st.pushAgent(prev.content) },
      { label: t("chatContinue"), onClick: () => st.pushAgent("Weiter. Setze genau hier an, ohne von vorn zu beginnen.") },
      {
        label: t("chatRevise"),
        onClick: () => st.pushAgent("Die letzte Antwort nachbessern: vollständig, lauffähig, danach ausführen."),
      },
      { label: t("chatApplyCode"), onClick: () => applyCodeBlocks(m.content) },
    );
  }
  items.push(
    { sep: true, label: "" },
    { label: t("chatSaveRef"), onClick: () => saveRef(`${m.role}-${m.id.slice(0, 6)}.md`, m.content) },
  );
  if (m.checkpointId) {
    items.push({
      label: t("restoreRound"),
      onClick: () => {
        const ok = st.restoreCheckpoint(m.checkpointId!);
        st.setNotice(ok ? t("restored") : t("noSnapshot"));
      },
    });
  }
  items.push({ label: t("chatDel"), danger: true, onClick: () => st.removeChat(m.id) });
  return items;
}
