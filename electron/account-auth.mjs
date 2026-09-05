import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import http from "node:http";
import crypto from "node:crypto";
import { shell } from "electron";
import { handleOnce } from "./ipc.mjs";

const GEMINI_CLIENT = process.env.ANVIL_GEMINI_CLIENT || "";
const GEMINI_SECRET = process.env.ANVIL_GEMINI_SECRET || "";
const GH_CLIENT = "178c6fc778ccc68e1d6a";

function preview(token) {
  const t = String(token || "");
  if (t.length < 12) return "…";
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
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

function pkce() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function loginGithubSync() {
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

function googlePath() {
  return join(os.homedir(), ".anvil", "google.json");
}

function parseGoogle(raw) {
  try {
    const j = JSON.parse(raw);
    const token = String(j.access_token || j.token || "").trim();
    if (!token) return null;
    return {
      token,
      refresh: String(j.refresh_token || j.refresh || "").trim() || undefined,
      email: String(j.email || "").trim() || undefined,
      expiresAt: Number(j.expiresAt || 0) || undefined,
    };
  } catch {
    return null;
  }
}

export async function loadGoogleAccount() {
  const p = googlePath();
  if (!existsSync(p)) return { ok: false, error: "Kein Google-Konto. Daten → Anmelden." };
  let auth = parseGoogle(readFileSync(p, "utf8"));
  if (!auth) return { ok: false, error: "Google-Datei unlesbar" };
  const client = process.env.ANVIL_GOOGLE_CLIENT || GEMINI_CLIENT;
  if (auth.refresh && client && auth.expiresAt && Date.now() + 120_000 >= auth.expiresAt) {
    try {
      const j = await formToken("https://oauth2.googleapis.com/token", {
        grant_type: "refresh_token",
        refresh_token: auth.refresh,
        client_id: client,
        ...(GEMINI_SECRET ? { client_secret: GEMINI_SECRET } : {}),
      });
      const token = String(j.access_token || "").trim();
      if (token) {
        auth = {
          ...auth,
          token,
          expiresAt: Date.now() + Number(j.expires_in || 3600) * 1000,
        };
        mkdirSync(join(os.homedir(), ".anvil"), { recursive: true });
        writeFileSync(p, JSON.stringify(auth, null, 2), "utf8");
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Google-Token abgelaufen" };
    }
  }
  return { ok: true, token: auth.token, email: auth.email, preview: preview(auth.token) };
}

export async function loginGoogle() {
  const client = process.env.ANVIL_GOOGLE_CLIENT || GEMINI_CLIENT;
  if (!client) throw new Error("Google Client-ID fehlt. Umgebungsvariable ANVIL_GOOGLE_CLIENT (Desktop-App).");
  const { verifier, challenge } = pkce();
  const state = crypto.randomBytes(16).toString("hex");
  const redirect = "http://127.0.0.1:1456/";
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", client);
  authUrl.searchParams.set("redirect_uri", redirect);
  authUrl.searchParams.set("scope", "email https://www.googleapis.com/auth/drive.appdata");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url || "/", redirect);
        const err = u.searchParams.get("error");
        const got = u.searchParams.get("code");
        const st = u.searchParams.get("state");
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        if (err || !got || st !== state) {
          res.end("<p>Google-Anmeldung fehlgeschlagen. Fenster schließen.</p>");
          server.close();
          reject(new Error(err || "Login abgebrochen"));
          return;
        }
        res.end("<p>Anvil ist mit Google verbunden. Fenster schließen.</p>");
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
    server.listen(1456, "127.0.0.1", () => {
      void shell.openExternal(authUrl.toString());
    });
    server.on("close", () => clearTimeout(t));
  });
  const j = await formToken("https://oauth2.googleapis.com/token", {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect,
    client_id: client,
    code_verifier: verifier,
    ...(GEMINI_SECRET ? { client_secret: GEMINI_SECRET } : {}),
  });
  const token = String(j.access_token || "").trim();
  if (!token) throw new Error("Kein access_token von Google");
  let email = "";
  try {
    const me = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    const u = await me.json();
    email = String(u.email || "");
  } catch {
    /* */
  }
  const auth = {
    token,
    refresh: String(j.refresh_token || "").trim() || undefined,
    email,
    expiresAt: Date.now() + Number(j.expires_in || 3600) * 1000,
  };
  mkdirSync(join(os.homedir(), ".anvil"), { recursive: true });
  writeFileSync(googlePath(), JSON.stringify(auth, null, 2), "utf8");
  return { ok: true, token, email, preview: preview(token) };
}

export function bindAccountIpc() {
  handleOnce("account-load", async (_e, kind) => {
    if (kind === "google") return loadGoogleAccount();
    return { ok: false, error: "Unbekanntes Konto." };
  });
  handleOnce("account-login", async (_e, kind) => {
    try {
      if (kind === "github") return await loginGithubSync();
      if (kind === "google") return await loginGoogle();
      return { ok: false, error: "Unbekanntes Konto." };
    } catch (err) { return { ok: false, error: err instanceof Error ? err.message : "Login fehlgeschlagen" }; }
  });
}
