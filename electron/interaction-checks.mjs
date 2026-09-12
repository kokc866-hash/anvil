import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const actions = new Set(["click", "fill", "reload", "visible", "text", "value", "count"]);
const mime = { html: "text/html", htm: "text/html", js: "text/javascript", mjs: "text/javascript", css: "text/css", json: "application/json", svg: "image/svg+xml", txt: "text/plain" };
function validate(p) {
  if (!p || typeof p.id !== "string" || p.id.length > 100 || !/^[a-zA-Z0-9-]+$/.test(p.id)) throw new Error("Ungültige Prüfkennung.");
  const s = p.scenario;
  if (!s || typeof s.id !== "string" || s.id.length > 100 || typeof s.name !== "string" || s.name.length > 160) throw new Error("Ungültige Prüfung.");
  if (typeof s.entry !== "string" || !/\.html?$/i.test(s.entry) || /(^\/|\\|(^|\/)\.\.?(\/|$)|:)/.test(s.entry)) throw new Error("Eine HTML-Datei im Projekt wählen.");
  if (!Array.isArray(s.steps) || !s.steps.length || s.steps.length > 40 || !s.steps.some(x => ["visible", "text", "value", "count"].includes(x?.action))) throw new Error("1 bis 40 Schritte mit mindestens einer Erwartung erforderlich.");
  for (const step of s.steps) {
    if (!step || !actions.has(step.action)) throw new Error("Unbekannter Prüfschritt.");
    if (step.action !== "reload" && (typeof step.selector !== "string" || !step.selector.trim() || step.selector.length > 500)) throw new Error("Ungültiger CSS-Selektor.");
    if (["fill", "text", "value", "count"].includes(step.action) && (typeof step.value !== "string" || step.value.length > 4000)) throw new Error("Ungültige Erwartung.");
    if (step.action === "count" && !/^(0|[1-9]\d{0,4})$/.test(step.value)) throw new Error("Ungültige Anzahl.");
  }
  if (!p.files || typeof p.files !== "object" || Array.isArray(p.files) || Object.keys(p.files).length > 3000) throw new Error("Projekt ist für diese Prüfung zu groß.");
  let bytes = 0;
  for (const [path, content] of Object.entries(p.files)) {
    if (typeof content !== "string" || /(^\/|\\|(^|\/)\.\.?(\/|$)|:)/.test(path) || path.startsWith(".anvil/")) throw new Error("Ungültige Projektdatei.");
    bytes += Buffer.byteLength(content);
    if (bytes > 20 * 1024 * 1024) throw new Error("HTML-Prüfung unterstützt bis zu 20 MB Textdateien.");
  }
  if (!Object.hasOwn(p.files, s.entry)) throw new Error("Startdatei fehlt im geprüften Projektstand.");
  for (const key of ["revision", "scenarioRevision"]) if (!/^[a-f0-9]{64}$/.test(p[key])) throw new Error("Projektstand fehlt.");
}

// Serialized into an isolated world, separate from the application's JavaScript globals.
function inspectStep(step) {
  let nodes;
  try { nodes = document.querySelectorAll(step.selector); } catch { return { fatal: true, ok: false, message: "CSS-Selektor ist ungültig." }; }
  if (step.action === "count") return { ok: nodes.length === Number(step.value), message: `Anzahl: ${nodes.length}; erwartet: ${step.value}` };
  if (nodes.length !== 1) return { ok: false, message: `${nodes.length} Elemente gefunden; genau eines erwartet.` };
  const el = nodes[0], style = getComputedStyle(el), rect = el.getBoundingClientRect();
  const visible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) !== 0;
  if (step.action === "visible") return { ok: visible, message: visible ? "Element ist sichtbar." : "Element ist nicht sichtbar." };
  if (step.action === "text") { const value = (el.textContent ?? "").trim(); return { ok: value === step.value, message: `Text: ${JSON.stringify(value.slice(0, 400))}; erwartet: ${JSON.stringify(step.value.slice(0, 400))}` }; }
  if (step.action === "value") { const value = String(el.value ?? ""); return { ok: value === step.value, message: `Wert: ${JSON.stringify(value.slice(0, 400))}; erwartet: ${JSON.stringify(step.value.slice(0, 400))}` }; }
  if (!visible || el.disabled || el.getAttribute("aria-disabled") === "true") return { ok: false, message: "Element ist verborgen oder deaktiviert." };
  el.scrollIntoView({ block: "center", inline: "center" });
  if (step.action === "click") {
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    const top = document.elementFromPoint(x, y);
    if (!top || (top !== el && !el.contains(top))) return { ok: false, message: "Ein anderes Element verdeckt das Klickziel." };
    return { ok: true, message: "Angeklickt.", click: { x: Math.round(x), y: Math.round(y) } };
  }
  if (step.action === "fill") {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || el.readOnly || (el instanceof HTMLInputElement && !["text", "search", "email", "url", "tel", "password", "number"].includes(el.type))) return { fatal: true, ok: false, message: "Ausfüllen unterstützt nur bearbeitbare Text- und Zahlenfelder." };
    el.focus();
    // Native input insertion below creates trusted keyboard editing events.
    return { ok: true, fill: true, message: "Feld ausgefüllt." };
  }
  return { fatal: true, ok: false, message: "Schritt nicht unterstützt." };
}

export async function runInteractionCheck(electron, payload, { signal, stepTimeoutMs = 3000 } = {}) {
  validate(payload);
  const startedAt = new Date().toISOString(), start = Date.now();
  const result = { id: payload.id, scenarioId: payload.scenario.id, revision: payload.revision, scenarioRevision: payload.scenarioRevision, status: "open", startedAt, durationMs: 0, steps: [], message: "Prüfung offen." };
  let window, server, partition, timedOut = false;
  const errors = [], blocked = [];
  const timeout = setTimeout(() => { timedOut = true; window?.destroy(); }, 90000);
  const cancel = () => { if (window && !window.isDestroyed()) window.destroy(); };
  signal?.addEventListener("abort", cancel, { once: true });
  const check = () => { if (signal?.aborted) throw new Error("Abgebrochen — kein Erfolgsnachweis."); if (timedOut) throw new Error("Zeitlimit erreicht — Prüfung offen."); };
  try {
    check();
    server = createServer((req, res) => {
      let path;
      try { path = decodeURIComponent(new URL(req.url, "http://snapshot").pathname).slice(1); } catch { res.writeHead(400).end(); return; }
      if (!Object.hasOwn(payload.files, path)) { res.writeHead(404).end("Datei fehlt im Projektstand"); return; }
      res.writeHead(200, { "Content-Type": `${mime[path.split(".").pop()?.toLowerCase()] || "text/plain"}; charset=utf-8`, "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'" });
      res.end(payload.files[path]);
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    partition = electron.session.fromPartition(`interaction-${randomUUID()}`, { cache: false });
    partition.setPermissionRequestHandler((_wc, _permission, reply) => reply(false));
    partition.setPermissionCheckHandler(() => false);
    partition.on("will-download", event => event.preventDefault());
    partition.webRequest.onBeforeRequest((details, done) => {
      const allowed = details.url.startsWith(origin + "/") || details.url.startsWith("data:") || details.url.startsWith("blob:");
      if (!allowed) blocked.push(details.url.slice(0, 120));
      done({ cancel: !allowed });
    });
    window = new electron.BrowserWindow({ show: false, width: 1100, height: 800, webPreferences: { session: partition, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false, devTools: false } });
    window.webContents.setWindowOpenHandler(() => { blocked.push("Neues Fenster"); return { action: "deny" }; });
    window.webContents.on("will-navigate", (event, url) => { if (!url.startsWith(origin + "/")) { event.preventDefault(); blocked.push("Navigation außerhalb des Projekts"); } });
    window.webContents.on("console-message", (_event, level, message) => {
      if (/Content Security Policy|violates.*directive|Refused to (load|connect|frame|send)/i.test(String(message))) blocked.push("Externe Ressource durch Inhaltsregeln gesperrt");
      else if (level >= 3 && errors.length < 10 && !String(message).includes("favicon")) errors.push(String(message).slice(0, 600));
    });
    const url = `${origin}/${payload.scenario.entry.split("/").map(encodeURIComponent).join("/")}`;
    await window.loadURL(url);
    for (const [index, step] of payload.scenario.steps.entries()) {
      check();
      if (step.action === "reload") {
        await window.loadURL(url);
        result.steps.push({ index, status: "passed", message: "Startseite neu geladen; Prüfspeicher bleibt erhalten." });
        continue;
      }
      let outcome;
      const until = Date.now() + stepTimeoutMs;
      do {
        check();
        outcome = await window.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `(${inspectStep.toString()})(${JSON.stringify(step)})` }]);
        if (outcome.ok || outcome.fatal) break;
        await new Promise(resolve => setTimeout(resolve, 80));
      } while (Date.now() < until);
      if (outcome.ok && outcome.click) {
        window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...outcome.click });
        window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...outcome.click });
      }
      if (outcome.ok && outcome.fill) {
        window.webContents.selectAll();
        if (step.value) await window.webContents.insertText(step.value);
        else { window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Backspace" }); window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Backspace" }); }
      }
      await new Promise(resolve => setTimeout(resolve, 80));
      check();
      result.steps.push({ index, status: outcome.ok ? "passed" : "failed", message: outcome.message });
      if (!outcome.ok) {
        result.status = blocked.length ? "open" : "failed";
        if (blocked.length) result.steps[result.steps.length - 1].status = "open";
        result.message = blocked.length ? "Externe Ressourcen benötigt; Prüfung offen. Nur Projektdateien sind verfügbar." : `Schritt ${index + 1}: ${outcome.message}`;
        return result;
      }
    }
    if (blocked.length) { result.status = "open"; result.message = "Externe Ressourcen oder Navigation benötigt. Die isolierte HTML-Prüfung erlaubt nur Projektdateien."; }
    else if (errors.length) { result.status = "failed"; result.message = `Browserfehler: ${errors.join(" · ")}`; }
    else { result.status = "passed"; result.message = "Alle gespeicherten Erwartungen für diesen Projektstand erfüllt."; }
  } catch (error) {
    result.status = "open";
    result.message = signal?.aborted ? "Abgebrochen — kein Erfolgsnachweis." : timedOut ? "Zeitlimit erreicht — Prüfung offen." : String(error?.message || error);
    if (result.steps.length < payload.scenario.steps.length) result.steps.push({ index: result.steps.length, status: "open", message: result.message });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
    if (window && !window.isDestroyed()) window.destroy();
    await partition?.clearStorageData().catch(() => {});
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    result.durationMs = Date.now() - start;
  }
  return result;
}

export function registerInteractionChecks({ ipcMain, BrowserWindow, session, assertTrustedSender }) {
  const jobs = new Map();
  ipcMain.handle("interaction-check-run", async (event, payload) => {
    assertTrustedSender(event);
    if (jobs.has(event.sender.id)) throw new Error("Eine Bedienprüfung läuft bereits.");
    const controller = new AbortController();
    const owner = event.sender, cancel = () => controller.abort();
    jobs.set(owner.id, { id: payload?.id, controller });
    owner.once("destroyed", cancel);
    const navigating = (_event, _url, _inPlace, mainFrame) => { if (mainFrame) cancel(); };
    owner.on("did-start-navigation", navigating);
    try { return await runInteractionCheck({ BrowserWindow, session }, payload, { signal: controller.signal }); }
    finally { jobs.delete(owner.id); owner.removeListener("destroyed", cancel); owner.removeListener("did-start-navigation", navigating); }
  });
  ipcMain.handle("interaction-check-cancel", (event, id) => {
    assertTrustedSender(event);
    const job = jobs.get(event.sender.id);
    if (!job || job.id !== id) return false;
    job.controller.abort(); return true;
  });
}
