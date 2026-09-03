import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import http from "node:http";
import crypto from "node:crypto";
import { BrowserWindow, shell } from "electron";
import { handleOnce } from "./ipc.mjs";

const CODEX_CLIENT = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_TOKEN = "https://auth.openai.com/oauth/token";
const CLAUDE_CLIENT = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_TOKEN = "https://console.anthropic.com/v1/oauth/token";
const GEMINI_CLIENT = process.env.ANVIL_GEMINI_CLIENT || "";
const GEMINI_SECRET = process.env.ANVIL_GEMINI_SECRET || "";
const GEMINI_TOKEN = "https://oauth2.googleapis.com/token";
const GH_CLIENT = "178c6fc778ccc68e1d6a";
const CLAUDE_REDIRECT = "https://console.anthropic.com/oauth/code/callback";
const CLAUDE_AUTH = "https://claude.ai/oauth/authorize";

function preview(token) {
  const t = String(token || "");
  if (t.length < 12) return "…";
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

function jwtExpMs(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return 0;
    const json = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return Number(json.exp || 0) * 1000;
  } catch {
    return 0;
  }
}

function jwtEmail(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return "";
    const json = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (typeof json.email === "string") return json.email;
    const p = json["https://api.openai.com/profile"];
    if (p && typeof p === "object" && typeof p.email === "string") return p.email;
    return "";
  } catch {
    return "";
  }
}

function jwtAccountId(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return "";
    const json = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    const auth = json["https://api.openai.com/auth"];
    if (auth && typeof auth === "object" && auth.chatgpt_account_id) return String(auth.chatgpt_account_id);
    return String(json.chatgpt_account_id || json.account_id || "");
  } catch {
    return "";
  }
}

function parseCodex(raw) {
  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  const tokens = j.tokens && typeof j.tokens === "object" ? j.tokens : j;
  const token = String(tokens.access_token || j.access_token || "").trim();
  if (!token || token === "null") return null;
  return {
    token,
    refresh: String(tokens.refresh_token || j.refresh_token || "").trim() || undefined,
    accountId: String(tokens.account_id || j.account_id || "").trim() || jwtAccountId(token) || undefined,
    idToken: String(tokens.id_token || j.id_token || ""),
  };
}

function parseClaude(raw) {
  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  const o = j.claudeAiOauth && typeof j.claudeAiOauth === "object" ? j.claudeAiOauth : j;
  const token = String(o.accessToken || o.access_token || "").trim();
  if (!token) return null;
  return {
    token,
    refresh: String(o.refreshToken || o.refresh_token || "").trim() || undefined,
    expiresAt: Number(o.expiresAt || o.expires_at || 0) || 0,
  };
}

function parseGemini(raw) {
  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  const token = String(j.access_token || j.accessToken || "").trim();
  if (!token) return null;
  return {
    token,
    refresh: String(j.refresh_token || j.refreshToken || "").trim() || undefined,
    expiresAt: Number(j.expiry_date || j.expiryDate || 0) || 0,
    email: String(j.email || ""),
  };
}

async function formToken(url, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Abo-Token: HTTP ${res.status}`);
  return JSON.parse(text);
}

export async function loadCodexSub() {
  const p = join(os.homedir(), ".codex", "auth.json");
  if (!existsSync(p)) return { ok: false, error: "Kein Codex-Login. Im Terminal: codex login" };
  let auth;
  try {
    auth = parseCodex(readFileSync(p, "utf8"));
  } catch {
    return { ok: false, error: "auth.json unlesbar" };
  }
  if (!auth) return { ok: false, error: "auth.json ohne Token. codex login" };
  const exp = jwtExpMs(auth.token);
  if (auth.refresh && exp && Date.now() + 120_000 >= exp) {
    try {
      const j = await formToken(CODEX_TOKEN, {
        grant_type: "refresh_token",
        refresh_token: auth.refresh,
        client_id: CODEX_CLIENT,
      });
      auth.token = String(j.access_token || "").trim();
      auth.refresh = String(j.refresh_token || auth.refresh).trim();
      auth.accountId = String(j.account_id || auth.accountId || "").trim() || auth.accountId;
      auth.idToken = String(j.id_token || auth.idToken || "");
      if (!auth.token) throw new Error("Kein access_token");
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Token abgelaufen. codex login" };
    }
  }
  return {
    ok: true,
    token: auth.token,
    refresh: auth.refresh,
    accountId: auth.accountId,
    email: jwtEmail(auth.idToken) || jwtEmail(auth.token) || "",
    preview: preview(auth.token),
  };
}

function pkce() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function loginCodex() {
  const { verifier, challenge } = pkce();
  const state = crypto.randomBytes(16).toString("hex");
  const redirect = "http://localhost:1455/auth/callback";
  const authUrl = new URL("https://auth.openai.com/oauth/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", CODEX_CLIENT);
  authUrl.searchParams.set("redirect_uri", redirect);
  authUrl.searchParams.set("scope", "openid profile email offline_access");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("id_token_add_organizations", "true");
  authUrl.searchParams.set("codex_cli_simplified_flow", "true");

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url || "/", "http://localhost:1455");
        if (u.pathname !== "/auth/callback") {
          res.statusCode = 404;
          res.end();
          return;
        }
        const err = u.searchParams.get("error");
        const got = u.searchParams.get("code");
        const st = u.searchParams.get("state");
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        if (err || !got || st !== state) {
          res.end("<p>Anmelden fehlgeschlagen. Fenster schließen.</p>");
          server.close();
          reject(new Error(err || "Login abgebrochen"));
          return;
        }
        res.end("<p>Anvil ist mit ChatGPT verbunden. Fenster schließen.</p>");
        server.close();
        resolve(got);
      } catch (e) {
        reject(e);
      }
    });
    const t = setTimeout(() => {
      server.close();
      reject(new Error("Login-Zeit abgelaufen"));
    }, 180000);
    server.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    server.listen(1455, "127.0.0.1", () => {
      void shell.openExternal(authUrl.toString());
    });
    server.on("close", () => clearTimeout(t));
  });

  const j = await formToken(CODEX_TOKEN, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect,
    client_id: CODEX_CLIENT,
    code_verifier: verifier,
  });
  const token = String(j.access_token || "").trim();
  if (!token) throw new Error("Kein access_token von ChatGPT");
  const refresh = String(j.refresh_token || "").trim();
  const idToken = String(j.id_token || "");
  const accountId = String(j.account_id || "").trim() || jwtAccountId(token);
  const dir = join(os.homedir(), ".codex");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "auth.json"),
    JSON.stringify(
      {
        tokens: { access_token: token, refresh_token: refresh, id_token: idToken, account_id: accountId },
        last_refresh: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
  return {
    ok: true,
    token,
    refresh,
    accountId,
    email: jwtEmail(idToken) || jwtEmail(token) || "",
    preview: preview(token),
  };
}

export async function loadClaudeSub() {
  const p = join(os.homedir(), ".claude", ".credentials.json");
  if (!existsSync(p)) return { ok: false, error: "Kein Claude-Login. Terminal: claude  dann /login" };
  let auth;
  try {
    auth = parseClaude(readFileSync(p, "utf8"));
  } catch {
    return { ok: false, error: ".credentials.json unlesbar" };
  }
  if (!auth) return { ok: false, error: "Kein Token. claude /login" };
  if (auth.refresh && auth.expiresAt && Date.now() + 120_000 >= auth.expiresAt) {
    try {
      const j = await formToken(CLAUDE_TOKEN, {
        grant_type: "refresh_token",
        refresh_token: auth.refresh,
        client_id: CLAUDE_CLIENT,
      });
      auth.token = String(j.access_token || j.accessToken || "").trim();
      auth.refresh = String(j.refresh_token || j.refreshToken || auth.refresh).trim();
      if (!auth.token) throw new Error("Kein access_token");
    } catch (err) {
      if (!auth.token || (auth.expiresAt && Date.now() >= auth.expiresAt)) {
        return { ok: false, error: err instanceof Error ? err.message : "Token abgelaufen. claude /login" };
      }
    }
  }
  return { ok: true, token: auth.token, refresh: auth.refresh, preview: preview(auth.token) };
}

export async function loadGeminiSub() {
  const p = join(os.homedir(), ".gemini", "oauth_creds.json");
  if (!existsSync(p)) return { ok: false, error: "Kein Gemini-CLI-Login. Terminal: gemini" };
  let auth;
  try {
    auth = parseGemini(readFileSync(p, "utf8"));
  } catch {
    return { ok: false, error: "oauth_creds.json unlesbar" };
  }
  if (!auth) return { ok: false, error: "Kein Token. gemini" };
  if (auth.refresh && GEMINI_CLIENT && auth.expiresAt && Date.now() + 120_000 >= auth.expiresAt) {
    try {
      const j = await formToken(GEMINI_TOKEN, {
        grant_type: "refresh_token",
        refresh_token: auth.refresh,
        client_id: GEMINI_CLIENT,
        client_secret: GEMINI_SECRET,
      });
      auth.token = String(j.access_token || "").trim();
      if (!auth.token) throw new Error("Kein access_token");
    } catch (err) {
      if (!auth.token || (auth.expiresAt && Date.now() >= auth.expiresAt)) {
        return { ok: false, error: err instanceof Error ? err.message : "Token abgelaufen. gemini" };
      }
    }
  }
  return {
    ok: true,
    token: auth.token,
    refresh: auth.refresh,
    email: auth.email || "",
    preview: preview(auth.token),
  };
}

function firstExisting(paths) {
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return "";
}

function parseGhHosts(raw) {
  const m = String(raw || "").match(/oauth_token:\s*["']?([A-Za-z0-9_\-]+)["']?/);
  if (!m?.[1]) return null;
  const user = String(raw).match(/^\s*user:\s*["']?([^\s"']+)/m);
  return { token: m[1], user: user?.[1] || "" };
}

export async function loadCopilotSub() {
  const home = os.homedir();
  const hostFile = firstExisting([
    join(home, ".config", "gh", "hosts.yml"),
    join(home, "AppData", "Roaming", "GitHub CLI", "hosts.yml"),
  ]);
  const cfgFile = firstExisting([join(home, ".copilot", "config.json")]);
  let auth = null;
  if (hostFile) {
    try {
      auth = parseGhHosts(readFileSync(hostFile, "utf8"));
    } catch {
      auth = null;
    }
  }
  if (!auth && cfgFile) {
    try {
      const j = JSON.parse(readFileSync(cfgFile, "utf8"));
      const token = String(j.github_token || j.oauth_token || j.token || j.access_token || "").trim();
      if (token) auth = { token, user: String(j.user || j.login || "") };
    } catch {
      auth = null;
    }
  }
  if (!auth) return { ok: false, error: "Kein Copilot-Login. Terminal: gh auth login" };
  return { ok: true, token: auth.token, email: auth.user || "", preview: preview(auth.token) };
}

export async function loadHfSub() {
  const home = os.homedir();
  const p = firstExisting([
    join(home, ".cache", "huggingface", "token"),
    join(home, ".huggingface", "token"),
    join(home, ".hf", "token"),
  ]);
  if (!p) return { ok: false, error: "Kein Hugging-Face-Login. Terminal: huggingface-cli login" };
  const token = readFileSync(p, "utf8").trim().split(/\s+/)[0] || "";
  if (!token) return { ok: false, error: "Token-Datei leer" };
  return { ok: true, token, preview: preview(token) };
}

export function scanSubs() {
  const home = os.homedir();
  const row = (kind, paths) => ({ kind, found: paths.some((p) => existsSync(p)) });
  return [
    row("codex", [join(home, ".codex", "auth.json")]),
    row("claude", [join(home, ".claude", ".credentials.json")]),
    row("gemini", [join(home, ".gemini", "oauth_creds.json")]),
    row("copilot", [
      join(home, ".config", "gh", "hosts.yml"),
      join(home, "AppData", "Roaming", "GitHub CLI", "hosts.yml"),
      join(home, ".copilot", "config.json"),
    ]),
    row("huggingface", [
      join(home, ".cache", "huggingface", "token"),
      join(home, ".huggingface", "token"),
      join(home, ".hf", "token"),
    ]),
  ];
}

async function jsonToken(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "claude-cli/2.0.27 (external, cli)" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Abo-Token: HTTP ${res.status} ${text.slice(0, 160)}`);
  return JSON.parse(text);
}

function captureRedirect(authUrl, pick) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const win = new BrowserWindow({
      width: 480,
      height: 740,
      title: "Anmelden",
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: "persist:anvil-oauth",
      },
    });
    win.setMenuBarVisibility(false);
    try {
      const ua = win.webContents.getUserAgent().replace(/Electron\/\S+\s*/g, "");
      win.webContents.setUserAgent(ua);
    } catch {
      /* */
    }
    const finish = (val, err) => {
      if (settled) return;
      settled = true;
      clearTimeout(tmr);
      if (!win.isDestroyed()) win.close();
      if (err) reject(err);
      else resolve(val);
    };
    const check = (url) => {
      try {
        const hit = pick(String(url || ""));
        if (hit) finish(hit);
      } catch {
        /* */
      }
    };
    const listen = (wc) => {
      wc.on("will-redirect", (_e, url) => check(url));
      wc.on("will-navigate", (_e, url) => check(url));
      wc.on("did-navigate", (_e, url) => check(url));
      wc.on("did-navigate-in-page", (_e, url) => check(url));
    };
    listen(win.webContents);
    win.webContents.setWindowOpenHandler(() => ({
      action: "allow",
      overrideBrowserWindowOptions: {
        width: 480,
        height: 720,
        autoHideMenuBar: true,
        webPreferences: {
          partition: "persist:anvil-oauth",
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      },
    }));
    win.webContents.on("did-create-window", (child) => {
      child.setMenuBarVisibility(false);
      listen(child.webContents);
    });
    const tmr = setTimeout(() => finish(null, new Error("Login-Zeit abgelaufen")), 180000);
    win.on("closed", () => {
      if (!settled) finish(null, new Error("Login abgebrochen"));
    });
    void win.loadURL(authUrl);
  });
}

function promptToken(title, hint) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 440,
      height: 220,
      title: `Anvil · ${title}`,
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    const html = `<!doctype html><html><body style="margin:0;font:13px system-ui;background:#141414;color:#eee;padding:16px">
      <p style="margin:0 0 10px">${hint}</p>
      <input id="t" type="password" style="width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1px solid #333;background:#0d0d0d;color:#eee" />
      <p style="margin:12px 0 0;text-align:right"><button id="ok" style="padding:6px 12px">Speichern</button></p>
      <script>
        document.getElementById("ok").onclick = () => {
          document.title = "ANVIL_TOKEN:" + document.getElementById("t").value;
        };
      </script></body></html>`;
    let done = false;
    win.on("page-title-updated", (_e, t) => {
      if (!t.startsWith("ANVIL_TOKEN:")) return;
      done = true;
      const tok = t.slice("ANVIL_TOKEN:".length).trim();
      win.close();
      resolve(tok);
    });
    win.on("closed", () => {
      if (!done) resolve("");
    });
    void win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  });
}

export async function loginClaude() {
  const { verifier, challenge } = pkce();
  const authUrl = new URL(CLAUDE_AUTH);
  authUrl.searchParams.set("code", "true");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", CLAUDE_CLIENT);
  authUrl.searchParams.set("redirect_uri", CLAUDE_REDIRECT);
  authUrl.searchParams.set("scope", "org:create_api_key user:profile user:inference");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", verifier);
  const raw = await captureRedirect(authUrl.toString(), (url) => {
    if (!/oauth\/code\/callback/.test(url)) return "";
    const u = new URL(url);
    let code = u.searchParams.get("code") || "";
    if (u.hash) code = code ? `${code}${u.hash}` : u.hash.slice(1);
    return code;
  });
  if (!raw) throw new Error("Kein Code von Claude");
  const j = await jsonToken(CLAUDE_TOKEN, {
    grant_type: "authorization_code",
    code: raw,
    redirect_uri: CLAUDE_REDIRECT,
    client_id: CLAUDE_CLIENT,
    code_verifier: verifier,
    state: verifier,
  });
  const token = String(j.access_token || j.accessToken || "").trim();
  if (!token) throw new Error("Kein access_token von Claude");
  const refresh = String(j.refresh_token || j.refreshToken || "").trim();
  const expiresAt = Date.now() + Number(j.expires_in || 28800) * 1000;
  const dir = join(os.homedir(), ".claude");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, ".credentials.json"),
    JSON.stringify({ claudeAiOauth: { accessToken: token, refreshToken: refresh, expiresAt, scopes: ["user:inference", "user:profile"] } }, null, 2),
    "utf8",
  );
  return { ok: true, token, refresh, preview: preview(token) };
}

export async function loginCopilot() {
  const start = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: GH_CLIENT, scope: "read:user gist read:org repo" }),
  });
  const d = await start.json();
  const device = String(d.device_code || "");
  const uri = String(d.verification_uri_complete || d.verification_uri || "");
  if (!device || !uri) throw new Error("GitHub Device-Login fehlgeschlagen");
  void shell.openExternal(uri);
  const interval = Math.max(5, Number(d.interval || 5)) * 1000;
  const until = Date.now() + Math.min(900, Number(d.expires_in || 900)) * 1000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, interval));
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: GH_CLIENT,
        device_code: device,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const j = await res.json();
    const token = String(j.access_token || "").trim();
    if (token) return { ok: true, token, email: String(j.login || ""), preview: preview(token) };
    if (j.error && j.error !== "authorization_pending" && j.error !== "slow_down") {
      throw new Error(String(j.error_description || j.error));
    }
  }
  throw new Error("GitHub-Login-Zeit abgelaufen");
}

export async function loginHf() {
  await shell.openExternal("https://huggingface.co/settings/tokens");
  const token = await promptToken("Hugging Face", "Im Browser anmelden, Token kopieren (hf_…), hier einfügen.");
  if (!token) throw new Error("Kein Token");
  if (!/^hf_/.test(token) && token.length < 16) throw new Error("Das sieht nicht nach einem HF-Token aus");
  const dir = join(os.homedir(), ".cache", "huggingface");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "token"), token, "utf8");
  return { ok: true, token, preview: preview(token) };
}

export function bindSubIpc() {
  handleOnce("sub-load", async (_e, kind) => {
    if (kind === "codex") return loadCodexSub();
    if (kind === "claude") return loadClaudeSub();
    if (kind === "gemini") return loadGeminiSub();
    if (kind === "copilot") return loadCopilotSub();
    if (kind === "huggingface") return loadHfSub();
    return { ok: false, error: "Unbekanntes Abo" };
  });
  handleOnce("sub-login", async (_e, kind) => {
    try {
      if (kind === "codex") return await loginCodex();
      if (kind === "claude") return await loginClaude();
      if (kind === "copilot") return await loginCopilot();
      if (kind === "huggingface") return await loginHf();
      return { ok: false, error: "Unbekanntes Abo" };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Login fehlgeschlagen" };
    }
  });
  handleOnce("sub-scan", () => scanSubs());
}
