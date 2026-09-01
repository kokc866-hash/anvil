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
