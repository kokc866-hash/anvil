import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";

export function exitDescription(code, signal, { timedOut = false, aborted = false } = {}) {
  if (aborted) return "Ausführung abgebrochen.";
  if (timedOut) return "Zeitlimit der Ausführung erreicht.";
  if (signal) return `Prozess durch ${signal} beendet.`;
  if (code === 0) return "";
  if (typeof code !== "number") return "Prozess ohne Exitcode beendet.";
  const unsigned = code >>> 0;
  const hex = unsigned.toString(16).toUpperCase().padStart(8, "0");
  const hints = {
    C0000135: "Eine benötigte DLL fehlt.",
    C000007B: "Programm oder DLL hat ein unpassendes Binärformat/eine andere Architektur.",
    C0000005: "Speicherzugriffsverletzung im gestarteten Programm.",
    C000001D: "Der Prozessor unterstützt eine ausgeführte Maschineninstruktion nicht.",
    C0000142: "DLL-Initialisierung fehlgeschlagen.",
    C000013A: "Programm wurde beendet oder das Konsolenfenster geschlossen.",
  };
  return `Exitcode ${code}${unsigned >= 0x80000000 ? ` (0x${hex})` : ""}.${hints[hex] ? " " + hints[hex] : ""}`;
}

export function quoteCommand(file, args) {
  return [file, ...args].map((arg) => /[\s"&()]/.test(arg) ? JSON.stringify(arg) : arg).join(" ");
}

/** Capture every exit, including silent failures and cancellation. GUI logs stay open. */
export function spawnRun(file, args, cwd, timeoutMs, env, opts = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    let child, stdout = "", stderr = "", settled = false, timedOut = false, aborted = false;
    let timer, grace, killTimer;
    const append = (kind, text) => {
      if (kind === "stdout") stdout = (stdout + text).slice(-120000);
      else stderr = (stderr + text).slice(-120000);
      const log = opts[`${kind}File`];
      if (log) { try { appendFileSync(log, text); } catch { /* Returned output remains available. */ } }
    };
    for (const kind of ["stdout", "stderr"]) if (opts[`${kind}File`]) writeFileSync(opts[`${kind}File`], "");
    const result = (code, signal, error = "", running = false) => {
      const detail = error || exitDescription(code, signal, { timedOut, aborted });
      return { ok: running || (code === 0 && !timedOut && !aborted), code: code ?? 1, signal: signal || undefined,
        stdout, stderr: [stderr.trim(), detail].filter(Boolean).join("\n"), duration: Date.now() - start,
        running, pid: child?.pid, timedOut, aborted };
    };
    const finish = (r) => { if (!settled) { settled = true; resolve(r); } };
    const terminate = () => {
      if (!child?.pid) return;
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.on("error", () => child.kill());
      } else {
        try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
        killTimer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }, 1500);
        killTimer.unref?.();
      }
    };
    const cancel = () => { aborted = true; terminate(); };
    if (opts.signal?.aborted) { aborted = true; finish(result(null, null)); return; }
    try {
      child = spawn(file, args, { cwd, shell: false, env, windowsHide: !opts.show, detached: process.platform !== "win32" || Boolean(opts.detach), stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) { finish(result(null, null, `Start fehlgeschlagen: ${error.message}`)); return; }
    child.once("spawn", () => opts.onStart?.(child.pid));
    child.stdout?.on("data", (data) => append("stdout", data.toString("utf8")));
    child.stderr?.on("data", (data) => append("stderr", data.toString("utf8")));
    // Headless runs cannot answer prompts; close stdin instead of leaving them hanging forever.
    child.stdin?.end();
    opts.signal?.addEventListener("abort", cancel, { once: true });
    const cleanup = () => { clearTimeout(timer); clearTimeout(grace); clearTimeout(killTimer); opts.signal?.removeEventListener("abort", cancel); };
    let exited = false;
    const exitedWith = (r) => { if (exited) return; exited = true; cleanup(); opts.onExit?.(r); finish(r); };
    child.once("error", (error) => exitedWith(result(null, null, `Start fehlgeschlagen (${error.code || "Prozess"}): ${error.message}`)));
    child.once("close", (code, signal) => exitedWith(result(code, signal)));
    if (opts.detach) {
      grace = setTimeout(() => {
        opts.signal?.removeEventListener("abort", cancel);
        finish(result(0, null, "", true));
      }, opts.readyMs ?? 2500);
    } else {
      timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs || 120000);
    }
  });
}
