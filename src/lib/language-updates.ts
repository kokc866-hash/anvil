import { companionLanguageUpdates, DEFAULT_COMPANION, type LanguageUpdateState } from "./companion";
import { withCompanion } from "./companion-life";
import { nativeHelper } from "./helper-local";
import { loadSecrets } from "./secrets";
import { useIde } from "@/store/ide";
import { t } from "./i18n";

const EVENT = "anvil-language-updates";
const cached = new Map<string, LanguageUpdateState>();
const pending = new Map<string, Promise<LanguageUpdateState>>();
const key = (base: string) => base.replace(/\/$/, "");

export function languageUpdateSnapshot(base: string): LanguageUpdateState | null {
  return cached.get(key(base)) || null;
}

export function watchLanguageUpdates(base: string, onChange: (value: LanguageUpdateState) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ base: string; state: LanguageUpdateState }>).detail;
    if (detail.base === key(base)) onChange(detail.state);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

function publish(base: string, state: LanguageUpdateState): LanguageUpdateState {
  cached.set(key(base), state);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { base: key(base), state } }));
  return state;
}

/** Hold only our own Companion lease, and leave the selected project unchanged. */
export async function readLanguageUpdates(base = DEFAULT_COMPANION): Promise<LanguageUpdateState> {
  return withCompanion(async () => publish(base, await companionLanguageUpdates(base)), base, "");
}

export async function configureLanguageUpdates(automatic: boolean, base = DEFAULT_COMPANION): Promise<LanguageUpdateState> {
  return withCompanion(async () => publish(base, await companionLanguageUpdates(base, { action: "configure", automatic })), base, "");
}

export function checkLanguageUpdates(manual = true, base = DEFAULT_COMPANION): Promise<LanguageUpdateState> {
  const id = key(base);
  const current = pending.get(id);
  if (current) return current;
  const work = withCompanion(async () => {
    const before = await companionLanguageUpdates(base);
    publish(base, before);
    if (!manual && (!before.automatic || Date.now() < (before.nextCheckAt || 0))) return before;
    publish(base, { ...before, checking: true });
    try { return publish(base, await companionLanguageUpdates(base, { action: "check", manual })); }
    catch (error) { publish(base, { ...before, checking: false }); throw error; }
  }, base, "").finally(() => pending.delete(id));
  pending.set(id, work);
  return work;
}

/** Startup + coarse timer. The persistent Companion cache enforces the daily interval. */
export function startLanguageUpdateMonitor(): () => void {
  let stopped = false, busy = false;
  const tick = async () => {
    if (stopped || busy) return;
    // The unpaired browser preview cannot start a local Companion or authenticate.
    if (!nativeHelper()?.companionEnsure && !loadSecrets().companionToken) return;
    busy = true;
    try {
      const base = useIde.getState().companionUrl || DEFAULT_COMPANION;
      const result = await checkLanguageUpdates(false, base);
      if (!stopped && result.automatic && result.updateCount > 0 && !result.checking && !useIde.getState().agentBusy && !useIde.getState().notice) {
        const fingerprint = result.items.filter((r) => r.status === "update" || r.status === "new-series").map((r) => `${r.id}:${r.latest}`).sort().join("|");
        const noticeKey = `anvil-language-update-notice:${base}:${result.home}`;
        let prior: string | null = null;
        try { prior = localStorage.getItem(noticeKey); } catch { /* Storage can be unavailable. */ }
        if (prior !== fingerprint) {
          try { localStorage.setItem(noticeKey, fingerprint); } catch { /* Keep the scan independent of browser storage. */ }
          useIde.getState().setNotice(t(result.updateCount === 1 ? "langUpdateNoticeOne" : "langUpdateNotice", { n: result.updateCount }));
        }
      }
    } catch { /* No repetitive startup/offline notices. Details remain in Settings. */ }
    finally { busy = false; }
  };
  const first = window.setTimeout(() => { void tick(); }, 15000);
  const periodic = window.setInterval(() => { void tick(); }, 30 * 60 * 1000);
  return () => { stopped = true; window.clearTimeout(first); window.clearInterval(periodic); };
}
