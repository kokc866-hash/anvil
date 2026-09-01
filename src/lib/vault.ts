import { loadSecrets, saveSecrets } from "./secrets";
import { envNames, redactPatterns, redactValues } from "./vault-redact";

export type VaultEntry = { id: string; name: string; value: string };
export { envNames };

const SESSION = "anvil-vault";

function migrateSession(): VaultEntry[] {
  if (typeof sessionStorage === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(SESSION);
    if (!raw) return [];
    const j = JSON.parse(raw) as VaultEntry[];
    sessionStorage.removeItem(SESSION);
    return Array.isArray(j) ? j.filter((x) => x && x.name) : [];
  } catch {
    return [];
  }
}

export function loadVault(): VaultEntry[] {
  const stored = loadSecrets().vault ?? [];
  if (stored.length) return stored;
  const old = migrateSession();
  if (old.length) saveVault(old);
  return old;
}

export function saveVault(rows: VaultEntry[]): void {
  saveSecrets({ vault: rows.filter((x) => x && (x.name || x.value)) });
}

export function allSecretValues(): string[] {
  const s = loadSecrets();
  const rows = s.vault ?? [];
  const out = [s.llmApiKey, s.githubToken, s.companionToken, ...Object.values(s.keys), ...rows.map((v) => v.value)];
  return [...new Set(out.map((v) => v.trim()).filter((v) => v.length >= 8))];
}

export function redactSecrets(text: string): { text: string; n: number } {
  const a = redactPatterns(text);
  const b = redactValues(a.text, allSecretValues());
  return { text: b.text, n: a.n + b.n };
}

export function vaultNames(): string[] {
  return loadVault().map((v) => v.name).filter(Boolean);
}
