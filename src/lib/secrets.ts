const KEY = "anvil-secrets";

export type Secrets = {
  llmApiKey: string;
  githubToken: string;
  companionToken: string;
  keys: Record<string, string>;
  vault: { id: string; name: string; value: string }[];
};

const EMPTY: Secrets = { llmApiKey: "", githubToken: "", companionToken: "", keys: {}, vault: [] };

function store(): Storage | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* private mode */
  }
  try {
    if (typeof sessionStorage !== "undefined") return sessionStorage;
  } catch {
    /* */
  }
  return null;
}

export function loadSecrets(): Secrets {
  const s = store();
  if (!s) return { ...EMPTY };
  try {
    const raw = s.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const j = JSON.parse(raw) as Partial<Secrets>;
    const keys = j.keys && typeof j.keys === "object" ? { ...j.keys } : {};
    // Legacy model OAuth copies are no longer used. CLI credential stores stay untouched.
    let migrated = false;
    const oldTokens = new Set<string>();
    for (const kind of ["codex", "claude", "copilot", "gemini"]) {
      for (const suffix of ["", "Account", "Refresh"]) {
        const key = kind + suffix;
        if (key in keys) { if (!suffix) oldTokens.add(keys[key]); delete keys[key]; migrated = true; }
      }
    }
    if (oldTokens.has(String(j.llmApiKey || ""))) j.llmApiKey = "";
    if (migrated) {
      try { s.setItem(KEY, JSON.stringify({ ...j, keys })); } catch { /* Read-only storage: still discard stale OAuth copies in memory. */ }
    }
    const vault = Array.isArray(j.vault)
      ? j.vault.filter((x) => x && typeof x === "object" && "name" in x)
      : [];
    const llmApiKey = String(j.llmApiKey ?? "");
    return {
      llmApiKey,
      githubToken: String(j.githubToken ?? ""),
      companionToken: String(j.companionToken ?? ""),
      keys,
      vault: vault as Secrets["vault"],
    };
  } catch {
    return { ...EMPTY };
  }
}

export function saveSecrets(partial: Partial<Secrets>): void {
  const s = store();
  if (!s) return;
  const cur = loadSecrets();
  const next: Secrets = {
    ...cur,
    ...partial,
    keys: { ...cur.keys, ...(partial.keys ?? {}) },
    vault: partial.vault ?? cur.vault,
  };
  s.setItem(KEY, JSON.stringify(next));
}

export function keyForProvider(provider: string): string {
  return String(loadSecrets().keys[provider] || "").trim();
}

export function saveKeyForProvider(provider: string, key: string): void {
  const s = loadSecrets();
  saveSecrets({ llmApiKey: key, keys: { ...s.keys, [provider]: key } });
}
