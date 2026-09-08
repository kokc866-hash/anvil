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
  constructor({ read, write, open }) {
    this.read = read;
    this.write = write;
    this.open = open;
  }

  async provider(config, interactive) {
    const key = oauthKey(config);
    const record = structuredClone((await this.read(key)) || { clients: {}, tokens: {} });
    record.clients ||= {};
    record.tokens ||= {};
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
    const save = () => this.write(key, structuredClone(record));
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
        const issuer = ctx?.issuer || record.issuer;
        if (config.oauthClientId)
          return { client_id: config.oauthClientId, ...(issuer ? { issuer } : {}) };
        return record.clients[issuer];
      },
      saveClientInformation: async (info, ctx) => {
        const issuer = ctx?.issuer || info.issuer;
        if (!issuer) throw new Error("OAuth-Aussteller fehlt.");
        record.clients[issuer] = info;
        record.issuer = issuer;
        await save();
      },
      tokens: (ctx) => record.tokens[ctx?.issuer || record.issuer],
      saveTokens: async (tokens, ctx) => {
        const issuer = ctx?.issuer || tokens.issuer;
        if (!issuer) throw new Error("OAuth-Aussteller fehlt.");
        record.tokens[issuer] = tokens;
        record.issuer = issuer;
        await save();
      },
      redirectToAuthorization: async (url) => {
        if (!interactive)
          throw new Error("MCP-Anmeldung erforderlich. Im MCP-Bereich »Anmelden« wählen.");
        if (
          url.protocol !== "https:" &&
          !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
        )
          throw new Error("Unsichere OAuth-Anmelde-URL.");
        interactive.redirected = true;
        await this.open(url.href);
      },
      saveCodeVerifier: (value) => {
        verifier = value;
      },
      codeVerifier: () => {
        if (!verifier) throw new Error("OAuth-Anmeldung abgelaufen.");
        return verifier;
      },
      saveDiscoveryState: (value) => {
        discovery = value;
      },
      discoveryState: () => discovery,
      invalidateCredentials: async (scope) => {
        if (scope === "all" || scope === "client") record.clients = {};
        if (scope === "all" || scope === "tokens") record.tokens = {};
        if (scope === "all" || scope === "verifier") verifier = "";
        if (scope === "all" || scope === "discovery") discovery = undefined;
        await save();
      },
    };
  }

  async logout(config) {
    await this.write(oauthKey(config), undefined);
  }

  async login(config, signal) {
    signal?.throwIfAborted();
    const record = await this.read(oauthKey(config));
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
    const abort = () => {
      controller.abort(new Error("MCP-Anmeldung abgebrochen."));
      rejectCallback(controller.signal.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 180_000);
    const interactive = {
      url: `http://127.0.0.1:${server.address().port}/callback`,
      state,
      redirected: false,
    };
    let client, transport;
    try {
      if (signal?.aborted) abort();
      controller.signal.throwIfAborted();
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
      if (interactive.redirected) await transport.finishAuth(await callback);
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
