import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import { mcpFetch } from "./mcp-host.mjs";

export function oauthKey(config) {
  return createHash("sha256")
    .update(JSON.stringify([config.id, new URL(config.url).href, config.oauthClientId || ""]))
    .digest("hex");
}

export class McpOAuth {
  constructor({ read, write, open, loginTimeoutMs = 600_000 }) {
    this.read = read;
    this.write = write;
    this.open = open;
    this.generations = new Map();
    this.pending = new Map();
    this.writes = new Map();
    this.authorizationLinks = new Map();
    this.loginTimeoutMs = loginTimeoutMs;
  }

  generation(key) {
    return this.generations.get(key) || 0;
  }

  invalidate(key) {
    this.generations.set(key, this.generation(key) + 1);
    this.pending.get(key)?.abort(new Error("MCP-Anmeldung abgebrochen."));
    this.pending.delete(key);
    this.authorizationLinks.delete(key);
  }

  queueWrite(key, work) {
    const task = (this.writes.get(key) || Promise.resolve()).then(work);
    const settled = task.catch(() => {});
    this.writes.set(key, settled);
    void settled.then(() => {
      if (this.writes.get(key) === settled) this.writes.delete(key);
    });
    return task;
  }

  async status(config) {
    const key = oauthKey(config),
      generation = this.generation(key);
    await this.writes.get(key);
    const record = await this.read(key);
    if (generation !== this.generation(key)) return { authenticated: false };
    const tokens = record?.tokens?.[record.issuer];
    const expiresAt = record?.expiresAt?.[record.issuer];
    return {
      authenticated: Boolean(
        tokens?.refresh_token ||
        (tokens?.access_token && (!Number.isFinite(expiresAt) || expiresAt > Date.now())),
      ),
    };
  }

  async provider(config, interactive, signal = interactive?.signal) {
    const key = oauthKey(config);
    const generation = this.generation(key);
    const check = () => {
      signal?.throwIfAborted();
      if (this.generation(key) !== generation) throw new Error("MCP-Anmeldung wurde getrennt.");
    };
    check();
    await this.writes.get(key);
    const record = structuredClone((await this.read(key)) || { clients: {}, tokens: {} });
    check();
    record.clients ||= {};
    record.tokens ||= {};
    record.expiresAt ||= {};
    let verifier = "";
    let discovery;
    const redirect = interactive?.url || record.redirect || "http://127.0.0.1/callback";
    // Dynamic registration binds exact redirect URIs. A new local port needs a
    // new registration, rather than reusing credentials with the wrong callback.
    if (interactive && record.redirect !== redirect) {
      record.clients = {};
      record.tokens = {};
    }
    record.redirect = redirect;
    const save = () => {
      check();
      const snapshot = structuredClone(record);
      return this.queueWrite(key, async () => {
        check();
        await this.write(key, snapshot);
        check();
      });
    };
    return {
      redirectUrl: redirect,
      clientMetadata: {
        client_name: "Anvil",
        redirect_uris: [redirect],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        application_type: "native",
      },
      state: () => interactive?.state || randomBytes(32).toString("hex"),
      clientInformation: (ctx) => {
        check();
        const issuer = ctx?.issuer || record.issuer;
        if (config.oauthClientId)
          return { client_id: config.oauthClientId, ...(issuer ? { issuer } : {}) };
        return record.clients[issuer];
      },
      saveClientInformation: async (info, ctx) => {
        check();
        const issuer = ctx?.issuer || info.issuer;
        if (!issuer) throw new Error("OAuth-Aussteller fehlt.");
        record.clients[issuer] = info;
        record.issuer = issuer;
        await save();
      },
      tokens: (ctx) => {
        check();
        return record.tokens[ctx?.issuer || record.issuer];
      },
      saveTokens: async (tokens, ctx) => {
        check();
        const issuer = ctx?.issuer || tokens.issuer;
        if (!issuer) throw new Error("OAuth-Aussteller fehlt.");
        record.tokens[issuer] = tokens;
        record.expiresAt[issuer] = Number.isFinite(tokens.expires_in)
          ? Date.now() + tokens.expires_in * 1000
          : undefined;
        record.issuer = issuer;
        await save();
      },
      redirectToAuthorization: async (url) => {
        check();
        if (!interactive)
          throw new Error("MCP-Anmeldung erforderlich. Im MCP-Bereich »Anmelden« wählen.");
        if (
          url.username ||
          url.password ||
          url.hash ||
          (url.protocol !== "https:" &&
            !(
              url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
            ))
        )
          throw new Error("Unsichere OAuth-Anmelde-URL.");
        interactive.redirected = true;
        this.authorizationLinks.set(key, { url: url.href, generation });
        interactive.progress?.(
          "Warte auf die Freigabe im Browser. Wenn nur die Startseite des Dienstes erscheint, öffne die Anmeldeseite hier erneut.",
        );
        await this.open(url.href);
      },
      saveCodeVerifier: (value) => {
        check();
        verifier = value;
      },
      codeVerifier: () => {
        check();
        if (!verifier) throw new Error("OAuth-Anmeldung abgelaufen.");
        return verifier;
      },
      saveDiscoveryState: (value) => {
        check();
        discovery = value;
      },
      discoveryState: () => {
        check();
        return discovery;
      },
      invalidateCredentials: async (scope) => {
        check();
        if (scope === "all" || scope === "client") record.clients = {};
        if (scope === "all" || scope === "tokens") {
          record.tokens = {};
          record.expiresAt = {};
        }
        if (scope === "all" || scope === "verifier") verifier = "";
        if (scope === "all" || scope === "discovery") discovery = undefined;
        await save();
      },
    };
  }

  async logout(config) {
    const key = oauthKey(config);
    this.invalidate(key);
    await this.queueWrite(key, () => this.write(key, undefined));
    return { authenticated: false };
  }

  async reopen(config) {
    const key = oauthKey(config),
      link = this.authorizationLinks.get(key);
    if (
      !link ||
      link.generation !== this.generation(key) ||
      !this.pending.has(key) ||
      this.pending.get(key).signal.aborted
    )
      throw new Error("Keine wartende Browser-Anmeldung. Anmeldung erneut starten.");
    await this.open(link.url);
    return { opened: true };
  }

  async login(config, signal, onProgress = () => {}) {
    const key = oauthKey(config);
    signal?.throwIfAborted();
    this.invalidate(key);
    const generation = this.generation(key),
      controller = new AbortController();
    this.pending.set(key, controller);
    let cleanup;
    const revoke = () => {
      if (this.generation(key) !== generation) return;
      this.generations.set(key, generation + 1);
      cleanup = this.queueWrite(key, () => this.write(key, undefined));
      void cleanup.catch(() => {});
    };
    const abort = () => controller.abort(new Error("MCP-Anmeldung abgebrochen."));
    controller.signal.addEventListener("abort", revoke, { once: true });
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (signal?.aborted) abort();
      return await this.runLogin(config, controller.signal, onProgress);
    } catch (error) {
      revoke();
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      controller.signal.removeEventListener("abort", revoke);
      if (this.pending.get(key) === controller) {
        this.pending.delete(key);
        this.authorizationLinks.delete(key);
      }
      await cleanup;
    }
  }

  async runLogin(config, signal, onProgress = () => {}) {
    signal?.throwIfAborted();
    await this.writes.get(oauthKey(config));
    const record = await this.read(oauthKey(config));
    signal?.throwIfAborted();
    let preferredPort = 0;
    try {
      preferredPort = Number(new URL(record?.redirect).port) || 0;
    } catch {
      /* first login */
    }
    const state = randomBytes(32).toString("hex");
    let resolveCallback, rejectCallback;
    const callback = new Promise((resolve, reject) => {
      resolveCallback = resolve;
      rejectCallback = reject;
    });
    let callbackReceived = false;
    void callback.catch(() => {});
    const server = createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (
        req.method !== "GET" ||
        url.pathname !== "/callback" ||
        url.searchParams.get("state") !== state
      ) {
        res.writeHead(400);
        res.end("Ungültige Anmeldung.");
        return;
      }
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end("Anmeldung empfangen. Bitte zu Anvil zurückkehren.");
      callbackReceived = true;
      this.authorizationLinks.delete(oauthKey(config));
      onProgress("Rückmeldung vom Browser empfangen. Anmeldung wird abgeschlossen …");
      if (url.searchParams.has("error"))
        rejectCallback(new Error(`OAuth: ${url.searchParams.get("error")}`));
      else if (!url.searchParams.get("code")) rejectCallback(new Error("OAuth-Code fehlt."));
      else resolveCallback(url.searchParams);
    });
    const bind = (port) =>
      new Promise((resolve, reject) => {
        const fail = (e) => {
          server.off("listening", done);
          reject(e);
        };
        const done = () => {
          server.off("error", fail);
          resolve();
        };
        server.once("error", fail);
        server.once("listening", done);
        server.listen(port, "127.0.0.1");
      });
    try {
      await bind(preferredPort);
    } catch (e) {
      if (!preferredPort || e.code !== "EADDRINUSE") throw e;
      await bind(0);
    }
    const controller = new AbortController();
    const stop = (reason) => {
      controller.abort(reason);
      rejectCallback(controller.signal.reason);
    };
    const abort = () => stop(signal?.reason || new Error("MCP-Anmeldung abgebrochen."));
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () =>
        stop(
          new Error(
            callbackReceived
              ? "Zeitlimit beim Abschließen der Anmeldung. Bitte erneut anmelden."
              : "Keine Rückmeldung vom Browser innerhalb von 10 Minuten. Der Konto-Login allein ist noch keine Freigabe für Anvil. Anmeldung erneut starten und die Freigabe beim Anbieter abschließen.",
          ),
        ),
      this.loginTimeoutMs,
    );
    const interactive = {
      url: `http://127.0.0.1:${server.address().port}/callback`,
      state,
      redirected: false,
      signal: controller.signal,
      progress: onProgress,
    };
    let client, transport;
    try {
      if (signal?.aborted) abort();
      controller.signal.throwIfAborted();
      onProgress("Anmeldung beim Dienst wird vorbereitet …");
      const provider = await this.provider(config, interactive);
      transport = new StreamableHTTPClientTransport(new URL(config.url), {
        authProvider: provider,
        fetch: (input, init) =>
          mcpFetch(input, {
            ...init,
            signal: AbortSignal.any([controller.signal, ...(init?.signal ? [init.signal] : [])]),
          }),
      });
      client = new Client(
        { name: "anvil", version: "1" },
        { versionNegotiation: { mode: "auto" }, capabilities: {} },
      );
      try {
        await client.connect(transport, {
          signal: controller.signal,
          timeout: config.timeoutMs || 120_000,
        });
      } catch (error) {
        if (!(error instanceof UnauthorizedError) || !interactive.redirected) throw error;
      }
      if (interactive.redirected) {
        const response = await callback;
        onProgress("Freigabe empfangen. Zugang wird sicher gespeichert …");
        await transport.finishAuth(response);
      }
      controller.signal.throwIfAborted();
      return { authenticated: Boolean(await provider.tokens()) };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      controller.abort();
      server.closeAllConnections();
      server.close();
      await client?.close().catch(() => {});
    }
  }
}
