/** Einstellungen in GitHub-Gist oder Google Drive appData. Keine Keys, außer syncKeys an. */

export const GIST_DESC = "anvil-settings";
const GIST_FILE = "anvil-settings.json";
const LS_GIST = "anvil-sync-gist";
const LS_GOOGLE = "anvil-sync-google-file";

export type SyncPack = {
  v: 1;
  at: number;
  settings: Record<string, unknown>;
};

export function makePack(settings: Record<string, unknown>): SyncPack {
  return { v: 1, at: Date.now(), settings };
}

export function parsePack(raw: unknown): SyncPack {
  const j = raw as SyncPack;
  if (!j || j.v !== 1 || !j.settings || typeof j.settings !== "object") throw new Error("Sync-Datei unlesbar");
  return j;
}

export function gistId(): string {
  try {
    return localStorage.getItem(LS_GIST) || "";
  } catch {
    return "";
  }
}

function setGistId(id: string) {
  try {
    if (id) localStorage.setItem(LS_GIST, id);
    else localStorage.removeItem(LS_GIST);
  } catch {
    /* */
  }
}

async function gh(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers as object),
    },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { message: text.slice(0, 180) };
  }
  if (!res.ok) {
    const msg = json && typeof json === "object" && "message" in json ? String((json as { message?: string }).message) : text.slice(0, 180);
    throw new Error(`GitHub ${res.status}: ${msg}`);
  }
  return json;
}

export async function findGist(token: string): Promise<string> {
  const known = gistId();
  if (known) return known;
  const list = (await gh(token, "/gists?per_page=50")) as { id?: string; description?: string }[];
  const hit = (Array.isArray(list) ? list : []).find((g) => g.description === GIST_DESC);
  if (hit?.id) {
    setGistId(hit.id);
    return hit.id;
  }
  return "";
}

export async function pushGist(token: string, pack: SyncPack): Promise<{ id: string }> {
  const body = JSON.stringify(pack);
  const files = { [GIST_FILE]: { content: body } };
  const id = await findGist(token);
  if (id) {
    await gh(token, `/gists/${id}`, { method: "PATCH", body: JSON.stringify({ description: GIST_DESC, files }) });
    return { id };
  }
  const created = (await gh(token, "/gists", {
    method: "POST",
    body: JSON.stringify({ description: GIST_DESC, public: false, files }),
  })) as { id?: string };
  const next = String(created.id || "");
  if (!next) throw new Error("Gist ohne ID");
  setGistId(next);
  return { id: next };
}

export async function pullGist(token: string): Promise<SyncPack | null> {
  const id = await findGist(token);
  if (!id) return null;
  const gist = (await gh(token, `/gists/${id}`)) as {
    files?: Record<string, { content?: string }>;
  };
  const raw = gist.files?.[GIST_FILE]?.content;
  if (!raw) return null;
  return parsePack(JSON.parse(raw));
}

export async function pushDrive(token: string, pack: SyncPack): Promise<{ id: string }> {
  const meta = {
    name: GIST_FILE,
    parents: ["appDataFolder"],
  };
  const known = (() => {
    try {
      return localStorage.getItem(LS_GOOGLE) || "";
    } catch {
      return "";
    }
  })();
  const boundary = "anvil" + Date.now();
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(known ? { name: GIST_FILE } : meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(pack)}\r\n` +
    `--${boundary}--`;
  const url = known
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(known)}?uploadType=multipart`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
  const res = await fetch(url, {
    method: known ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
    signal: AbortSignal.timeout(20000),
  });
  const j = (await res.json()) as { id?: string; error?: { message?: string } };
  if (!res.ok) throw new Error(j.error?.message || `Drive ${res.status}`);
  const id = String(j.id || known);
  try {
    if (id) localStorage.setItem(LS_GOOGLE, id);
  } catch {
    /* */
  }
  return { id };
}

export async function pullDrive(token: string): Promise<SyncPack | null> {
  const known = (() => {
    try {
      return localStorage.getItem(LS_GOOGLE) || "";
    } catch {
      return "";
    }
  })();
  let id = known;
  if (!id) {
    const q = encodeURIComponent("name = 'anvil-settings.json'");
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    const j = (await res.json()) as { files?: { id?: string }[] };
    id = String(j.files?.[0]?.id || "");
    if (id) {
      try {
        localStorage.setItem(LS_GOOGLE, id);
      } catch {
        /* */
      }
    }
  }
  if (!id) return null;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Drive ${res.status}`);
  return parsePack(await res.json());
}
