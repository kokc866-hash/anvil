/** Account sync credentials are unrelated to CLI model subscriptions. */
type AccountKind = "github" | "google";
type AccountResult =
  { ok: true; token: string; email?: string; preview: string } | { ok: false; error: string };
async function account(
  action: "accountLoad" | "accountLogin",
  kind: AccountKind,
): Promise<AccountResult> {
  if (typeof window === "undefined")
    return { ok: false, error: "Konto-Anmeldung benötigt die Desktop-App." };
  const api = (
    window as unknown as {
      anvilNative?: Record<typeof action, (kind: AccountKind) => Promise<AccountResult>>;
    }
  ).anvilNative;
  if (!api?.[action]) return { ok: false, error: "Konto-Anmeldung benötigt die Desktop-App." };
  try {
    return await api[action](kind);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Konto-Anmeldung fehlgeschlagen.",
    };
  }
}
export const loadAccountFromNative = (kind: AccountKind) => account("accountLoad", kind);
export const loginAccountFromNative = (kind: AccountKind) => account("accountLogin", kind);
