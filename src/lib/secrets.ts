const KEY = "anvil-secrets";

export type Secrets = {
  llmApiKey: string;
  githubToken: string;
  companionToken: string;
  keys: Record<string, string>;
  vault: { id: string; name: string; value: string }[];
};

type SecretSnapshot = {
  ok: boolean;
  persistent: boolean;
  browserMigrated: boolean;
  revision: number;
  secrets: Secrets;
  credentials?: { ref: string; value: string }[];
  error?: string;
};
type SecretBridge = {
  secretsLoad: () => SecretSnapshot | null;
  secretsSave: (
    partial: Partial<Secrets>,
    options?: { migrate?: boolean },
  ) => Promise<SecretSnapshot>;
};

function native(): SecretBridge | null {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { anvilNative?: Partial<SecretBridge> }).anvilNative;
  return api?.secretsLoad && api.secretsSave ? (api as SecretBridge) : null;
}

function store(): Storage | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* unavailable */
  }
  try {
    if (typeof sessionStorage !== "undefined") return sessionStorage;
  } catch {
    /* unavailable */
  }
  return null;
}

function normalize(value: Partial<Secrets> | null): Secrets {
  const j = value ?? {};
  const keys =
    j.keys && typeof j.keys === "object"
      ? Object.fromEntries(Object.entries(j.keys).filter(([, value]) => typeof value === "string"))
      : {};
  const oldTokens = new Set<string>();
  // CLI subscriptions exclusively use their own login stores.
  for (const kind of ["codex", "claude", "copilot", "gemini"]) {
    for (const suffix of ["", "Account", "Refresh"]) {
      const key = kind + suffix;
      if (key in keys) {
        if (!suffix) oldTokens.add(keys[key]);
        delete keys[key];
      }
    }
  }
  return {
    llmApiKey: oldTokens.has(String(j.llmApiKey || "")) ? "" : String(j.llmApiKey ?? ""),
    githubToken: String(j.githubToken ?? ""),
    companionToken: String(j.companionToken ?? ""),
    keys,
    vault: Array.isArray(j.vault)
      ? j.vault.filter(
          (v) =>
            v &&
            typeof v.id === "string" &&
            typeof v.name === "string" &&
            typeof v.value === "string",
        )
      : [],
  };
}

function merge(current: Secrets, partial: Partial<Secrets>): Secrets {
  return normalize({
    ...current,
    ...partial,
    keys: { ...current.keys, ...partial.keys },
    vault: partial.vault ?? current.vault,
  });
}

let cached: Secrets | null = null;
let info: SecretSnapshot | null = null;
let pending: Partial<Secrets> | null = null;
let writing: Promise<void> | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;
let legacyRaw: string | null = null;
let migrate = false;
let errorText = "";

function changed() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("anvil-secret-status"));
}

function schedule() {
  clearTimeout(idle);
  idle = setTimeout(() => {
    void flushSecrets().catch(() => undefined);
  }, 250);
  deadline ??= setTimeout(() => {
    void flushSecrets().catch(() => undefined);
  }, 1000);
}

export function loadSecrets(): Secrets {
  const bridge = native();
  if (!bridge) {
    try {
      return normalize(JSON.parse(store()?.getItem(KEY) || "null"));
    } catch {
      return normalize(null);
    }
  }
  const state = bridge.secretsLoad();
  if (!cached) {
    info = state;
    try {
      legacyRaw = store()?.getItem(KEY) ?? null;
    } catch {
      /* unavailable */
    }
    let legacy = normalize(null);
    try {
      legacy = normalize(JSON.parse(legacyRaw || "null"));
    } catch {
      /* malformed old entry */
    }
    const saved = normalize(state?.secrets ?? null);
    cached = state?.browserMigrated
      ? saved
      : {
          llmApiKey: saved.llmApiKey || legacy.llmApiKey,
          githubToken: saved.githubToken || legacy.githubToken,
          companionToken: saved.companionToken || legacy.companionToken,
          keys: { ...legacy.keys, ...saved.keys },
          vault: saved.vault.length ? saved.vault : legacy.vault,
        };
    if (legacyRaw) {
      // Preserve legacy data until the native store acknowledges a durable write.
      migrate = true;
      pending = cached;
      schedule();
    }
  } else if (state && (!info || state.revision > info.revision) && !pending && !writing) {
    cached = normalize(state.secrets);
    info = state;
  }
  return cached;
}

export function saveSecrets(partial: Partial<Secrets>): void {
  const current = loadSecrets();
  const next = merge(current, partial);
  if (!native()) {
    store()?.setItem(KEY, JSON.stringify(next));
    return;
  }
  cached = next;
  pending = { ...pending, ...partial, keys: { ...pending?.keys, ...partial.keys } };
  schedule();
  changed();
}

function restorePending(patch: Partial<Secrets>) {
  pending = { ...patch, ...pending, keys: { ...patch.keys, ...pending?.keys } };
}

export async function flushSecrets(): Promise<void> {
  clearTimeout(idle);
  clearTimeout(deadline);
  idle = deadline = undefined;
  if (writing) {
    await writing;
    if (pending) return flushSecrets();
    return;
  }
  const bridge = native();
  if (!bridge || !pending) return;
  const patch = pending;
  pending = null;
  writing = (async () => {
    try {
      const result = await bridge.secretsSave(patch, { migrate });
      info = result;
      cached = merge(normalize(result.secrets), pending ?? {});
      errorText = result.error || "";
      if (result.persistent && result.browserMigrated && legacyRaw !== null) {
        const storage = store();
        if (storage?.getItem(KEY) === legacyRaw) storage.removeItem(KEY);
        legacyRaw = null;
        migrate = false;
      }
    } catch (error) {
      restorePending(patch);
      errorText = "Schlüssel konnten nicht dauerhaft gespeichert werden.";
      void import("./intern").then((m) => m.note("persist", errorText));
      throw error;
    } finally {
      writing = null;
      changed();
    }
  })();
  await writing;
}

export function secretStorageStatus(): string {
  loadSecrets();
  if (!native()) return "Schlüssel werden im Browser-Speicher dieses Geräts gespeichert.";
  if (errorText || info?.error) return errorText || info!.error!;
  if (pending || writing) return "Schlüssel werden gesichert …";
  return info?.persistent
    ? "Schlüssel werden verschlüsselt über den Betriebssystem-Schlüsselspeicher gesichert."
    : "Betriebssystem-Schlüsselspeicher nicht verfügbar. Neue Schlüssel gelten nur für diese Sitzung.";
}

/** Replace known keys on the local pipe with opaque, process-local references. */
export function credentialHeaders(headers: Record<string, string>): {
  headers: Record<string, string>;
  refs: string;
} {
  loadSecrets();
  const credentials = native()?.secretsLoad()?.credentials ?? info?.credentials ?? [];
  const next = { ...headers };
  const refs: Record<string, { ref: string; scheme: "bearer" | "raw" }> = {};
  for (const header of ["authorization", "x-api-key", "api-key"]) {
    const value = next[header];
    if (!value) continue;
    const scheme = header === "authorization" && /^Bearer /i.test(value) ? "bearer" : "raw";
    const secret = scheme === "bearer" ? value.slice(7) : value;
    const known = credentials.find((c) => c.value === secret);
    if (known) {
      refs[header] = { ref: known.ref, scheme };
      delete next[header];
    }
  }
  return { headers: next, refs: Object.keys(refs).length ? JSON.stringify(refs) : "" };
}

export function keyForProvider(provider: string): string {
  return String(loadSecrets().keys[provider] || "").trim();
}
export function saveKeyForProvider(provider: string, key: string): void {
  saveSecrets({ llmApiKey: key, keys: { [provider]: key } });
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    void flushSecrets().catch(() => undefined);
  });
  if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) void flushSecrets().catch(() => undefined);
    });
}
