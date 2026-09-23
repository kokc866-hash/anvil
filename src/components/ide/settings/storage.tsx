import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

import {
  clearLocation,
  diskSupported,
  loadSlotAll,
  locationName,
  pickLocation,
  saveSlot,
  type DiskSlot,
} from "@/lib/disk";

import { ANVIL_BUILD, ANVIL_VERSION } from "@/lib/version";

import { loadVault, saveVault, type VaultEntry } from "@/lib/vault";

import { nativeHelper } from "@/lib/helper-local";

import { useIde, type StorageMode } from "@/store/ide";
import { applyLang, useT } from "@/lib/i18n";
import { confirmApp } from "@/lib/confirm";

import { applySettingsPack, exportSettingsPack, resetAllSettings } from "@/lib/settings-io";
import { makePack, pullDrive, pullGist, pushDrive, pushGist } from "@/lib/account-sync";
import { checkAppUpdate, setupAppUpdate, zipAppUpdate } from "@/lib/app-update";

import { loadAccountFromNative, loginAccountFromNative } from "@/lib/account-auth";

import { SettingsSection, Head, Vis, Row, Seg, Toggle } from "./fields";

export function StorageSection({ q }: { q: string }) {
  const storageMode = useIde((s) => s.storageMode);
  const autoSaveDisk = useIde((s) => s.autoSaveDisk);
  const loadOnStart = useIde((s) => s.loadOnStart);
  const diskName = useIde((s) => s.diskName);
  const backupName = useIde((s) => s.backupName);
  const setStorageMode = useIde((s) => s.setStorageMode);
  const setAutoSaveDisk = useIde((s) => s.setAutoSaveDisk);
  const setLoadOnStart = useIde((s) => s.setLoadOnStart);
  const setDiskName = useIde((s) => s.setDiskName);
  const setBackupName = useIde((s) => s.setBackupName);
  const applyFiles = useIde((s) => s.applyFiles);
  const openFile = useIde((s) => s.openFile);
  const setNotice = useIde((s) => s.setNotice);
  const ok = diskSupported();
  const native = nativeHelper();
  const [paths, setPaths] = useState<{
    data: string;
    helper: string;
    logs: string;
    packages?: string;
  } | null>(null);

  useEffect(() => {
    if (!q) void native?.pathsGet?.().then(setPaths).catch(() => undefined);
  }, [native, q]);

  async function pickNative(kind: "data" | "helper" | "logs" | "packages") {
    if (!native?.pathsPick) return;
    try {
      const next = await native.pathsPick(kind);
      setPaths(next);
      if (kind === "packages" && next.packages) {
        try {
          const { companionSetHome, DEFAULT_COMPANION } = await import("@/lib/companion");
          const url = useIde.getState().companionUrl || DEFAULT_COMPANION;
          await companionSetHome(next.packages, url);
        } catch {
          /* Companion aus — Pfad gilt beim nächsten Start */
        }
      }
      setNotice(
        kind === "helper"
          ? `Helfer-Modelle: ${next.helper}`
          : kind === "logs"
            ? `Protokollordner: ${next.logs}`
            : kind === "packages"
              ? `Pakete: ${next.packages}`
              : `App-Daten: ${next.data}`,
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Kein Ordner ausgewählt.");
    }
  }

  async function dumpToData() {
    if (!native?.pathsWrite) return;
    try {
      const p = await native.pathsWrite(
        "anvil-settings.json",
        JSON.stringify(exportSettingsPack(), null, 2),
      );
      setNotice(`Einstellungen gespeichert: ${p}`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Sichern fehlgeschlagen");
    }
  }

  async function loadFromData() {
    if (!native?.pathsRead) return;
    try {
      const raw = await native.pathsRead("anvil-settings.json");
      if (!raw) {
        setNotice("Im Anwendungsdatenordner wurde keine anvil-settings.json gefunden.");
        return;
      }
      applySettingsPack(JSON.parse(raw) as Record<string, unknown>);
      applyLang(useIde.getState().locale);
      setNotice("Einstellungen aus dem Anwendungsdatenordner geladen.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Laden fehlgeschlagen");
    }
  }

  async function choose(slot: DiskSlot, load: boolean) {
    try {
      const name = await pickLocation(slot);
      if (slot === "workspace") setDiskName(name);
      else setBackupName(name);
      if (load) {
        const pack = await loadSlotAll(slot);
        applyFiles(pack.files, pack.dirs);
        const first = Object.keys(pack.files).sort()[0];
        if (first) openFile(first);
        const n = Object.keys(pack.files).length;
        setNotice(
          pack.skipped
            ? `${n} Dateien aus ${name} geladen; ${pack.skipped} Dateien übersprungen.`
            : `${n} Dateien aus ${name} geladen.`,
        );
      } else {
        setNotice(`Speicherort: ${name}`);
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Kein Ordner ausgewählt.");
    }
  }

  async function saveNow(slot: DiskSlot) {
    try {
      await saveSlot(slot, useIde.getState().files, useIde.getState().dirs);
      setNotice(slot === "backup" ? "Sicherungskopie erstellt." : "Im Projektordner gespeichert.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    }
  }

  async function drop(slot: DiskSlot) {
    await clearLocation(slot);
    if (slot === "workspace") setDiskName("");
    else setBackupName("");
    setNotice("Ordnerverbindung getrennt. Die Dateien bleiben erhalten.");
  }

  return (
    <SettingsSection q={q}>
      <Head>Speicher</Head>
      <Vis q={q} label="Speicherort Browser Ordner">
        <Row label="Arbeitskopie" hint="Anvil behält eine Arbeitskopie im lokalen Anwendungsspeicher. Mit „Ordner“ werden die Dateien zusätzlich in einem Projektordner gespeichert.">
          <Seg<StorageMode>
            value={storageMode}
            onChange={(v) => {
              setStorageMode(v);
              if (v === "disk") setAutoSaveDisk(true);
              else setAutoSaveDisk(false);
            }}
            options={[
              { id: "browser", label: "Browser" },
              { id: "disk", label: "Ordner" },
            ]}
          />
        </Row>
      </Vis>
      {!ok ? (
        <p className="py-2 text-xs text-muted text-pretty">
          Um einen Ordner auszuwählen, öffne Anvil direkt in Chrome oder Edge. In einer eingebetteten Ansicht ist die Ordnerauswahl nicht verfügbar.
        </p>
      ) : null}
      <Vis q={q} label="Workspace Ordner Projekt wählen laden">
        <p className="pt-3 text-xs font-medium text-fg">Projektordner</p>
        <p className="text-xs text-muted">
          {diskName || locationName("workspace") || "Kein Ordner gewählt"}
        </p>
        <div className="flex flex-wrap gap-1.5 py-2">
          <Button className="h-8" onClick={() => void choose("workspace", false)}>
            Ordner wählen
          </Button>
          <Button className="h-8" onClick={() => void choose("workspace", true)}>
            Öffnen
          </Button>
          <Button className="h-8" onClick={() => void saveNow("workspace")}>
            Speichern
          </Button>
          <Button className="h-8" onClick={() => void drop("workspace")}>
            Trennen
          </Button>
        </div>
      </Vis>
      <Vis q={q} label="Beim Start vom Ordner laden">
        <Row label="Beim Start laden" hint="Lädt den gewählten Projektordner beim Start von Anvil.">
          <Toggle on={loadOnStart} onChange={setLoadOnStart} />
        </Row>
      </Vis>
      <Vis q={q} label="Automatisch auf Platte speichern">
        <Row label="Automatisch speichern" hint="Speichert Änderungen nach kurzer Verzögerung im Projektordner.">
          <Toggle on={autoSaveDisk} onChange={setAutoSaveDisk} />
        </Row>
      </Vis>
      <Vis q={q} label="Backup Ordner Kopie">
        <p className="pt-3 text-xs font-medium text-fg">Sicherungskopie</p>
        <p className="text-xs text-muted">
          {backupName || locationName("backup") || "Kein Sicherungsordner ausgewählt"}
        </p>
        <div className="flex flex-wrap gap-1.5 py-2">
          <Button className="h-8" onClick={() => void choose("backup", false)}>
            Ordner wählen
          </Button>
          <Button className="h-8" onClick={() => void saveNow("backup")}>
            Sicherung erstellen
          </Button>
          <Button className="h-8" onClick={() => void drop("backup")}>
            Trennen
          </Button>
        </div>
      </Vis>
      {native?.pathsPick ? (
        <Vis q={q} label="Helfer Modelle App-Daten Logs Pfad Festplatte">
          <p className="pt-4 text-xs font-medium text-fg">Anvil-Daten auf diesem Computer</p>
          <p className="mb-2 text-xs text-muted">
            Jeder Bereich hat einen eigenen Ordner. Compiler und Sprachserver findest du unter „Pakete“.
            API-Schlüssel werden separat verwaltet. Ihren Speicherstatus findest du unter Einstellungen → Agent.
          </p>
          {(
            [
              ["data", "Einstellungen / Sicherung", paths?.data],
              ["helper", "Helfer-Modelle", paths?.helper],
              ["packages", "Pakete (Compiler und Sprachserver)", paths?.packages],
              ["logs", "Protokolle", paths?.logs],
            ] as const
          ).map(([kind, label, path]) => (
            <div key={kind} className="py-2">
              <p className="text-sm text-fg">{label}</p>
              <p className="font-mono text-[10px] text-subtle break-all">{path || "…"}</p>
              <Button className="mt-1 h-8" onClick={() => void pickNative(kind)}>
                Ordner wählen
              </Button>
            </div>
          ))}
          <Button className="mt-1 h-8" onClick={() => void dumpToData()}>
            Einstellungen lokal sichern
          </Button>
          <Button className="mt-1 h-8" onClick={() => void loadFromData()}>
            Lokale Einstellungen laden
          </Button>
        </Vis>
      ) : (
        <p className="pt-3 text-xs text-muted">
          Speicherorte für Helfer-Modelle und Protokolle kannst du in der Desktop-App auswählen.
          Projekt- und Sicherungsordner lassen sich auch hier verwalten.
        </p>
      )}
    </SettingsSection>
  );
}

function VaultFields() {
  const [rows, setRows] = useState<VaultEntry[]>(() =>
    typeof window === "undefined" ? [] : loadVault(),
  );
  const setNotice = useIde((s) => s.setNotice);

  function persist(next: VaultEntry[]) {
    setRows(next);
    saveVault(next);
  }

  return (
    <div className="py-2">
      <p className="mb-1 text-xs text-muted">
        Der Tresor speichert Zugangsdaten auf diesem Computer. Den Speicherstatus findest du unter „Agent“.
        Tresorinhalte werden nicht mit Chats oder ZIP-Dateien exportiert.
      </p>
      {rows.map((r, i) => (
        <div key={r.id} className="mb-1 flex gap-1">
          <input
            value={r.name}
            placeholder="Name"
            className="h-8 w-28 rounded-md border border-border bg-bg px-2 text-sm text-fg"
            onChange={(e) =>
              persist(rows.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)))
            }
          />
          <input
            type="password"
            value={r.value}
            placeholder="Wert"
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-sm text-fg"
            onChange={(e) =>
              persist(rows.map((x, n) => (n === i ? { ...x, value: e.target.value } : x)))
            }
          />
          <button
            type="button"
            className="text-[11px] text-danger"
            onClick={() => persist(rows.filter((_, n) => n !== i))}
          >
            Löschen
          </button>
        </div>
      ))}
      <Button
        className="mt-1 h-8"
        onClick={() => {
          persist([...rows, { id: `v-${Date.now().toString(36)}`, name: "", value: "" }]);
          setNotice("Im Tresor gespeichert");
        }}
      >
        Zugangsdaten hinzufügen
      </Button>
    </div>
  );
}

export function DataSection({ q }: { q: string }) {
  const resetWorkspace = useIde((s) => s.resetWorkspace);
  const setLlmApiKey = useIde((s) => s.setLlmApiKey);
  const setNotice = useIde((s) => s.setNotice);
  const autoUpdate = useIde((s) => s.autoUpdate);
  const setAutoUpdate = useIde((s) => s.setAutoUpdate);
  const setGithubToken = useIde((s) => s.setGithubToken);
  const t = useT();
  const [upd, setUpd] = useState("");
  const [busy, setBusy] = useState(false);
  const [gh, setGh] = useState("");
  const [go, setGo] = useState("");

  async function runUpdate(kind: "check" | "zip" | "setup") {
    setBusy(true);
    try {
      const r =
        kind === "check"
          ? await checkAppUpdate()
          : kind === "zip"
            ? await zipAppUpdate()
            : await setupAppUpdate();
      if (r.canceled) return;
      if (!r.ok) {
        const msg = r.error || "Aktualisierung fehlgeschlagen.";
        setUpd(msg);
        setNotice(msg);
        return;
      }
      if (kind === "check") {
        const msg = r.newer
          ? t("updateReady", { v: r.latest || "" })
          : t("updateCurrent", { v: r.current || r.latest || "" });
        setUpd(r.notes ? `${msg}\n${r.notes.slice(0, 280)}` : msg);
        setNotice(msg);
        return;
      }
      const msg = r.message || r.dir || r.path || "Aktualisierung erfolgreich.";
      setUpd(msg);
      setNotice(msg);
    } finally {
      setBusy(false);
    }
  }

  async function sign(kind: "copilot" | "google") {
    setBusy(true);
    try {
      const r = await loginAccountFromNative(kind === "copilot" ? "github" : "google");
      if (!r.ok) {
        setNotice(r.error);
        return;
      }
      if (kind === "copilot" && r.token) {
        setGithubToken(r.token);
        setGh(r.email || r.preview || "GitHub");
      } else {
        setGo(r.email || r.preview || "Google");
      }
      setNotice("Angemeldet");
    } finally {
      setBusy(false);
    }
  }

  function gistToken() {
    return useIde.getState().githubToken.trim();
  }

  async function googleToken() {
    const r = await loadAccountFromNative("google");
    if (!r.ok) throw new Error(r.error);
    if (!r.token) throw new Error("Keine Google-Anmeldung verfügbar. Melde dich erneut an.");
    return r.token;
  }

  async function sync(where: "gist" | "drive", dir: "push" | "pull") {
    setBusy(true);
    try {
      if (where === "gist") {
        const token = gistToken();
        if (!token) throw new Error("Melde dich bei GitHub an oder trage einen Zugangsschlüssel ein.");
        if (dir === "push") {
          const { id } = await pushGist(token, makePack(exportSettingsPack()));
          setNotice(`Einstellungen als GitHub-Gist gespeichert: ${id.slice(0, 8)}`);
        } else {
          const pack = await pullGist(token);
          if (!pack) throw new Error("Keine gesicherten Einstellungen in GitHub Gist gefunden.");
          applySettingsPack(pack.settings);
          const loc = useIde.getState().locale;
          applyLang(loc === "en" || loc === "de" ? loc : "de");
          setNotice("Einstellungen aus GitHub Gist geladen.");
        }
        return;
      }
      const token = await googleToken();
      if (dir === "push") {
        await pushDrive(token, makePack(exportSettingsPack()));
        setNotice("Einstellungen in Google Drive gespeichert.");
      } else {
        const pack = await pullDrive(token);
        if (!pack) throw new Error("Keine gesicherten Einstellungen in Google Drive gefunden.");
        applySettingsPack(pack.settings);
        const loc = useIde.getState().locale;
        applyLang(loc === "en" || loc === "de" ? loc : "de");
        setNotice("Einstellungen aus Google Drive geladen.");
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Synchronisierung fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  function exportSettings() {
    const blob = new Blob([JSON.stringify(exportSettingsPack(), null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "anvil-settings.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importSettings() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void file.text().then((raw) => {
        try {
          const data = JSON.parse(raw) as Record<string, unknown>;
          applySettingsPack(data);
          const loc = useIde.getState().locale;
          applyLang(loc === "en" || loc === "de" ? loc : "de");
          setNotice("Einstellungen importiert");
        } catch (err) {
          setNotice(err instanceof Error ? err.message : "Ungültige Datei");
        }
      });
    };
    input.click();
  }

  return (
    <SettingsSection q={q}>
      <Head>Daten</Head>
      <p className="py-2 font-mono text-[11px] text-muted">
        Anvil {ANVIL_VERSION} · {ANVIL_BUILD}
      </p>
      <Vis q={q} label="Update prüfen ZIP Setup GitHub Release Patch Electron">
        <Head>{t("checkUpdate")}</Head>
        <Row label={t("autoUpdate")} hint={t("autoUpdateHint")}>
          <Toggle on={autoUpdate} onChange={setAutoUpdate} />
        </Row>
        <div className="flex flex-wrap gap-2 py-2">
          <Button className="h-8" disabled={busy} onClick={() => void runUpdate("check")}>
            {t("updateNow")}
          </Button>
          <Button className="h-8" disabled={busy} onClick={() => void runUpdate("zip")}>
            {t("updateZip")}
          </Button>
          <Button className="h-8" disabled={busy} onClick={() => void runUpdate("setup")}>
            {t("updateSetup")}
          </Button>
        </div>
        {upd ? (
          <p className="whitespace-pre-wrap pb-2 font-mono text-[11px] text-muted">{upd}</p>
        ) : null}
      </Vis>
      <Vis q={q} label="Konto Sync GitHub Gist Google Drive anmelden">
        <Head>{t("konto")}</Head>
        <p className="pb-1 text-xs text-muted">{t("kontoGithubHint")}</p>
        <div className="flex flex-wrap gap-2 py-2">
          <Button className="h-8" disabled={busy} onClick={() => void sign("copilot")}>
            {t("githubSignIn")}
          </Button>
          <Button className="h-8" disabled={busy} onClick={() => void sync("gist", "push")}>
            {t("syncPush")}
          </Button>
          <Button className="h-8" disabled={busy} onClick={() => void sync("gist", "pull")}>
            {t("syncPull")}
          </Button>
        </div>
        {gh ? <p className="pb-2 font-mono text-[11px] text-muted">{gh}</p> : null}
        <p className="pt-1 text-xs text-muted">{t("kontoGoogleHint")}</p>
        <div className="flex flex-wrap gap-2 py-2">
          <Button className="h-8" disabled={busy} onClick={() => void sign("google")}>
            {t("googleSignIn")}
          </Button>
          <Button className="h-8" disabled={busy} onClick={() => void sync("drive", "push")}>
            {t("syncPush")}
          </Button>
          <Button className="h-8" disabled={busy} onClick={() => void sync("drive", "pull")}>
            {t("syncPull")}
          </Button>
        </div>
        {go ? <p className="pb-2 font-mono text-[11px] text-muted">{go}</p> : null}
      </Vis>
      <Vis q={q} label="Tresor Vault Secrets Geheimnisse Zugangsdaten"><VaultFields /></Vis>
      <Vis q={q} label="Einstellungen exportieren importieren Settings export import">
        <p className="py-2 text-xs text-muted">Die Sicherung enthält Anbietereinstellungen, die gewählte Zugangsart, Profile und Gedächtnisinhalte. API-Schlüssel und CLI-Anmeldungen bleiben separat auf diesem Computer gespeichert.</p>
        <div className="flex flex-wrap gap-2 py-3">
          <Button className="h-8" onClick={exportSettings}>
            Exportieren
          </Button>
          <Button className="h-8" onClick={importSettings}>
            Importieren
          </Button>
        </div>
      </Vis>
      <Vis q={q} label="API-Key löschen">
        <div className="py-2">
          <Button className="h-8" onClick={() => setLlmApiKey("")}>
            API-Schlüssel löschen
          </Button>
        </div>
      </Vis>
      <Vis q={q} label="Einstellungen zurücksetzen Settings reset defaults">
        <p className="py-2 text-xs text-muted">Setzt alle Einstellungen zur Bedienung und Ausführung auf die Standardwerte zurück, einschließlich Helfer, Modelle und Layout. Gespeicherte Profile, MCP-Verbindungen, gelernte Werkzeugzuordnungen, Zugangsdaten, Projektdateien und Gedächtnisinhalte bleiben erhalten. Einzelne Bereiche kannst du links unten zurücksetzen.</p>
        <div className="py-2">
          <Button
            className="h-8"
            onClick={() => {
              resetAllSettings();
              applyLang(useIde.getState().locale);
              setNotice("Einstellungen zurückgesetzt");
            }}
          >
            Nur Einstellungen zurücksetzen
          </Button>
        </div>
      </Vis>
      <Vis q={q} label="Workspace zurücksetzen Beispiel">
        <div className="py-2">
          <Button
            variant="danger"
            className="h-8"
            onClick={() => {
              void confirmApp("Dateien und Chat zurücksetzen?", {
                danger: true,
                ok: "Zurücksetzen",
              }).then((ok) => {
                if (ok) resetWorkspace();
              });
            }}
          >
            Projekt zurücksetzen
          </Button>
        </div>
      </Vis>
    </SettingsSection>
  );
}
