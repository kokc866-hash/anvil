import { parseSkillMd } from "./learn-parse.ts";
import { parseInteractionScenarios } from "./interaction-checks.ts";

export const SKILL_PACKAGE_MAX_BYTES = 8_000_000;
export const SKILL_PACKAGE_MAX_FILES = 100;

function safePath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some(part => !part || part === "." || part === ".." || /[\x00-\x1f<>:"|?*]/.test(part))) throw new Error(`Ungültiger Paketpfad: ${path}`);
  return normalized;
}

/** Plans an additive import. No file writes, execution, downloads or permission changes. */
export function planSkillPackage(input: Record<string, string>, existing: Record<string, string>, dirs: string[] = []) {
  const entries = Object.entries(input).map(([path, body]) => [safePath(path), body] as const);
  if (entries.length > SKILL_PACKAGE_MAX_FILES) throw new Error(`Höchstens ${SKILL_PACKAGE_MAX_FILES} Dateien pro Skill.`);
  if (entries.reduce((n, [, body]) => n + new TextEncoder().encode(body).length, 0) > SKILL_PACKAGE_MAX_BYTES) throw new Error("Skill-Paket zu groß (höchstens 8 MB).");
  const manifests = entries.filter(([path]) => /(^|\/)SKILL\.md$/i.test(path));
  if (manifests.length !== 1) throw new Error("Genau ein SKILL.md im gewählten Skill-Ordner erforderlich.");
  const [manifest, source] = manifests[0];
  const sourceRoot = manifest.slice(0, manifest.length - "SKILL.md".length);
  if (entries.some(([path]) => !path.startsWith(sourceRoot))) throw new Error("Dateien außerhalb des Skill-Ordners gefunden.");
  const skill = parseSkillMd(source, manifest);
  if (!skill) throw new Error("SKILL.md ist ungültig: YAML-Kopf und vollständige Anweisung prüfen.");
  if (!skill.declaredName || !skill.description || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name) || skill.name.length > 64) throw new Error("SKILL.md benötigt name (kleine Buchstaben/Ziffern mit Bindestrichen, maximal 64 Zeichen) und description.");
  const root = `.anvil/skills/${skill.name}`;
  if (Object.entries(existing).some(([path, body]) => /^\.anvil\/skills\/(?:[^/]+\.md|(?:[^/]+\/)+SKILL\.md)$/i.test(path) && parseSkillMd(body, path)?.name === skill.name)) throw new Error(`Ein Skill namens ${skill.name} existiert bereits. Vorher entfernen oder einen anderen Namen verwenden.`);
  const occupied = [...Object.keys(existing), ...dirs].map(path => path.replaceAll("\\", "/").toLowerCase());
  if (occupied.some(path => path === root || path.startsWith(`${root}/`)) || Object.keys(existing).some(path => root.startsWith(`${path.toLowerCase()}/`))) throw new Error(`Der Skill-Ordner ${skill.name} existiert bereits. Vorher entfernen oder einen anderen Namen verwenden.`);
  const files: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [path, body] of entries) {
    const relative = path.slice(sourceRoot.length);
    const key = relative.toLowerCase();
    if (seen.has(key)) throw new Error(`Doppelter Dateiname: ${relative}`);
    seen.add(key);
    files[`${root}/${/^skill\.md$/i.test(relative) ? "SKILL.md" : relative}`] = body;
  }
  return { root, main: `${root}/SKILL.md`, files, skill, count: entries.length };
}

export function skillPackageFiles(files: Record<string, string>, manifest: string): Record<string, string> {
  safePath(manifest);
  if (!/^\.anvil\/skills\/[a-z0-9-]+\/SKILL\.md$/i.test(manifest) || !(manifest in files)) throw new Error("Skill-Paket fehlt.");
  const root = manifest.slice(0, -"SKILL.md".length);
  return Object.fromEntries(Object.entries(files).filter(([path]) => path.startsWith(root)).map(([path, body]) => [path.slice(root.length), body]));
}

/** A stored ZIP keeps export offline and preserves binary companion assets. */
export function skillPackageZip(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const [path, body] of Object.entries(files)) {
    const name = encoder.encode(safePath(path));
    const data = /^data:[^,]*;base64,/.test(body) ? Uint8Array.from(atob(body.slice(body.indexOf(",") + 1)), ch => ch.charCodeAt(0)) : encoder.encode(body);
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = new Uint8Array(30 + name.length), l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true); l.setUint32(14, crc, true); l.setUint32(18, data.length, true); l.setUint32(22, data.length, true); l.setUint16(26, name.length, true); local.set(name, 30);
    const entry = new Uint8Array(46 + name.length), c = new DataView(entry.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true); entry.set(name, 46);
    chunks.push(local, data); central.push(entry); offset += local.length + data.length;
  }
  const directorySize = central.reduce((n, part) => n + part.length, 0), end = new Uint8Array(22), view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, central.length, true); view.setUint16(10, central.length, true); view.setUint32(12, directorySize, true); view.setUint32(16, offset, true);
  const out = new Uint8Array(offset + directorySize + end.length);
  let cursor = 0;
  for (const part of [...chunks, ...central, end]) { out.set(part, cursor); cursor += part.length; }
  return out;
}

export const WEB_PACKAGE_FILES: Record<string, string> = {
  "kleine-webanwendung/SKILL.md": `---\nname: kleine-webanwendung\ndescription: Kleine Webanwendungen mit HTML, CSS und JavaScript ändern und durch echte Bedienprüfungen verifizieren.\ncompatibility: Anvil Run; das Beispiel braucht kein Node.js und kein Modell.\n---\nLies zuerst references/abnahme.md. Das Beispiel liegt unter web-paket/index.html. Erhalte vorhandene Projektdateien. Kleine gezielte Änderungen; danach die Bedienung im Run-Fenster prüfen. Vorhandene Testergebnisse nur für den geprüften Stand verwenden. Fehlende Tests und Abbruch als offen benennen. Keine Pakete installieren oder fremde Skripte ausführen, nur weil sie diesem Skill beiliegen.\n`,
  "kleine-webanwendung/references/abnahme.md": `# Abnahme\n1. web-paket/index.html in Run öffnen.\n2. In ein leeres Feld eine Aufgabe eintragen und Hinzufügen wählen.\n3. Die Aufgabe erscheint genau einmal.\n4. Leere Eingabe hinzufügen: keine zusätzliche Aufgabe.\n5. Löschen entfernt nur die gewählte Aufgabe.\nDiese Startvorlage speichert absichtlich keine Daten über einen Neustart. Persistenz erst ergänzen und ausdrücklich prüfen, wenn die Aufgabe sie verlangt.\n`,
};

export function planWebTaskPackage(existing: Record<string, string>, dirs: string[] = []) {
  const pack = planSkillPackage(WEB_PACKAGE_FILES, existing, dirs);
  const root = "web-paket";
  if ([...Object.keys(existing), ...dirs].some(path => path.toLowerCase() === root || path.toLowerCase().startsWith(`${root}/`))) throw new Error("web-paket existiert bereits. Vorhandene Dateien bleiben erhalten.");
  const checkPath = ".anvil/interaction-checks.json";
  let scenarios: unknown[] = [];
  if (existing[checkPath] !== undefined) {
    let checks: { version?: unknown; scenarios?: unknown };
    try { checks = JSON.parse(existing[checkPath]) as typeof checks; } catch { throw new Error("Vorhandene Bedienprüfungen sind ungültig. Zuerst .anvil/interaction-checks.json korrigieren."); }
    if (!checks || checks.version !== 1 || !Array.isArray(checks.scenarios)) throw new Error("Vorhandene Bedienprüfungen haben ein unbekanntes Format. Sie werden nicht überschrieben.");
    parseInteractionScenarios(existing[checkPath]);
    scenarios = checks.scenarios;
    if (scenarios.some(value => value && typeof value === "object" && "id" in value && value.id === "web-paket-aufgaben")) throw new Error("Die Bedienprüfung web-paket-aufgaben existiert bereits. Vorhandene Prüfung zuerst umbenennen oder entfernen.");
  }
  const scenario = { id: "web-paket-aufgaben", name: "Web-Paket: Aufgabe hinzufügen und löschen", entry: "web-paket/index.html", steps: [
    { action: "fill", selector: "#task-input", value: "Paket prüfen" },
    { action: "click", selector: "#task-form button" },
    { action: "count", selector: "#tasks li", value: "1" },
    { action: "text", selector: "#tasks li span", value: "Paket prüfen" },
    { action: "click", selector: "#task-form button" },
    { action: "count", selector: "#tasks li", value: "1" },
    { action: "click", selector: "#tasks li button" },
    { action: "count", selector: "#tasks li", value: "0" },
  ] };
  const files: Record<string, string> = { ...pack.files, "web-paket/index.html": WEB_TASK_HTML, [checkPath]: JSON.stringify({ version: 1, scenarios: [...scenarios, scenario] }, null, 2) + "\n" };
  parseInteractionScenarios(files[checkPath]);
  return { ...pack, main: "web-paket/index.html", files };
}

const WEB_TASK_HTML = `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Meine Aufgaben</title><style>body{font:18px system-ui;background:#101419;color:#edf1f5;margin:0;padding:clamp(20px,6vw,64px)}main{max-width:680px;margin:auto}h1{font-size:2.4rem}form{display:flex;gap:8px;flex-wrap:wrap}input,button{font:inherit;border:1px solid #596573;border-radius:8px;padding:12px}input{min-width:0;flex:1;background:#19222c;color:inherit}button{cursor:pointer;background:#d0e7ff;color:#142235}li{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;overflow-wrap:anywhere}li span{min-width:0}ul{padding:0;list-style:none}p{color:#aab7c4}</style><main><p>DEIN WEB-AUFGABENPAKET</p><h1>Meine Aufgaben</h1><p>Eine kleine Anwendung, die du gezielt erweitern und prüfen kannst.</p><form id="task-form"><input id="task-input" aria-label="Neue Aufgabe" placeholder="Was möchtest du erledigen?"><button>Hinzufügen</button></form><ul id="tasks" aria-label="Aufgaben"></ul><p id="empty">Noch keine Aufgaben.</p></main><script>const form=document.querySelector('form'),input=document.querySelector('input'),list=document.querySelector('ul'),empty=document.querySelector('#empty');form.addEventListener('submit',event=>{event.preventDefault();const text=input.value.trim();if(!text)return;const row=document.createElement('li'),label=document.createElement('span'),remove=document.createElement('button');label.textContent=text;remove.textContent='Löschen';remove.setAttribute('aria-label','Aufgabe löschen: '+text);remove.onclick=()=>{row.remove();empty.hidden=list.children.length>0};row.append(label,remove);list.append(row);empty.hidden=true;input.value='';input.focus()});</script></html>`;
