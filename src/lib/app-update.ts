import { nativeHelper } from "./helper-local";
import { useIde } from "@/store/ide";

export type UpdateInfo = {
  ok: boolean;
  newer?: boolean;
  latest?: string;
  current?: string;
  name?: string;
  notes?: string;
  htmlUrl?: string;
  zipUrl?: string;
  setupUrl?: string;
  error?: string;
  canceled?: boolean;
  dir?: string;
  path?: string;
};

function missing(): UpdateInfo {
  return { ok: false, error: "Update nur im Anvil-Fenster (Desktop), nicht in der Vorschau." };
}

export async function checkAppUpdate(): Promise<UpdateInfo> {
  const n = nativeHelper();
  if (!n?.updateCheck) return missing();
  return n.updateCheck();
}

export async function zipAppUpdate(): Promise<UpdateInfo> {
  const n = nativeHelper();
  if (!n?.updateZip) return missing();
  return n.updateZip();
}

export async function setupAppUpdate(): Promise<UpdateInfo> {
  const n = nativeHelper();
  if (!n?.updateSetup) return missing();
  return n.updateSetup();
}

export async function openAppRelease(url: string): Promise<boolean> {
  const n = nativeHelper();
  if (!n?.updateOpen) return false;
  return n.updateOpen(url);
}

/** Beim Start: wenn neuer Release da ist, eine Zeile in der Statusleiste. */
export async function bootUpdateCheck(): Promise<void> {
  const st = useIde.getState();
  if (!st.autoUpdate) return;
  const n = nativeHelper();
  if (!n?.updateCheck) return;
  try {
    const info = await n.updateCheck();
    if (info.ok && info.newer && info.latest) {
      st.setNotice(`Anvil ${info.latest} bereit — Einstellungen → Daten`);
    }
  } catch {
    /* offline */
  }
}
