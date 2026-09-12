import { spawn } from "node:child_process";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";

export function mcpConfig(input) {
  if (!input || typeof input.id !== "string" || !/^[\w:-]{1,120}$/.test(input.id))
    throw new Error("Ungültige MCP-Server-Id.");
  const config = {
    ...input,
    timeoutMs: Math.min(600_000, Math.max(8000, Number(input.timeoutMs) || 120_000)),
  };
  if (
    config.connectionToken != null &&
    (typeof config.connectionToken !== "string" || !/^[\w-]{1,80}$/.test(config.connectionToken))
  )
    throw new Error("Ungültige MCP-Verbindungsgeneration.");
  if (config.transport === "stdio") {
    if (
      typeof config.command !== "string" ||
      !config.command.trim() ||
      config.command.includes("\0")
    )
      throw new Error("MCP-Programm fehlt.");
    if (
      config.args != null &&
      (!Array.isArray(config.args) ||
        config.args.some((a) => typeof a !== "string" || a.includes("\0")))
    )
      throw new Error("MCP-Argumente müssen eine Liste von Texten sein.");
    if (
      config.env != null &&
      (typeof config.env !== "object" ||
        Array.isArray(config.env) ||
        Object.entries(config.env).some(
          ([k, v]) =>
            !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || typeof v !== "string" || v.includes("\0"),
        ))
    )
      throw new Error("Ungültige MCP-Umgebung.");
    if (config.cwd != null && (typeof config.cwd !== "string" || config.cwd.includes("\0")))
      throw new Error("Ungültiger MCP-Arbeitsordner.");
  } else {
    const url = new URL(config.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
      throw new Error("MCP benötigt eine HTTP(S)-URL ohne Zugangsdaten oder Fragment.");
    config.url = url.href;
    config.transport = "http";
  }
  config.headers = Object.fromEntries(
    Object.entries(config.headers || {}).filter(
      ([k, v]) =>
        ["authorization", "x-anvil-token"].includes(k.toLowerCase()) && typeof v === "string",
    ),
  );
  return config;
}

// Do not forward MCP credentials across redirects. OAuth endpoints have their
// own scoped requests through the SDK and may be on a different issuer origin.
export async function mcpFetch(input, init = {}) {
  const response = await fetch(input, { ...init, redirect: "error" });
  return response;
}

export class McpHost {
  constructor({ version = "1", emit = () => {}, oauth } = {}) {
    this.version = version;
    this.emit = emit;
    this.oauth = oauth;
    this.sessions = new Map();
  }

  async close(id) {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    // Snapshot only for best-effort remote session deletion before revoking the
    // provider's connection signal; no refresh or new credential write occurs.
    let closingTokens;
    try {
      closingTokens = session.provider?.tokens();
    } catch {
      /* already logged out */
    }
    session.controller.abort();
    // Session deletion needs its own short-lived signal: the connection signal
    // has already been canceled. Keep authentication, including LAN/OAuth.
    if (session.transport instanceof StreamableHTTPClientTransport && session.transport.sessionId) {
      const sid = session.transport.sessionId;
      void (async () => {
        const headers = {
          ...session.config.headers,
          "mcp-session-id": sid,
          "mcp-protocol-version": session.client.getNegotiatedProtocolVersion(),
        };
        const tokens = await closingTokens;
        if (tokens?.access_token) headers.authorization = `Bearer ${tokens.access_token}`;
        const response = await mcpFetch(session.config.url, {
          method: "DELETE",
          headers,
          signal: AbortSignal.timeout(4000),
        });
        await response.body?.cancel();
      })().catch(() => {});
    }
    let killTree;
    if (
      process.platform === "win32" &&
      session.transport instanceof StdioClientTransport &&
      session.transport.pid
    ) {
      const pid = session.transport.pid;
      killTree = new Promise((resolve) => {
        const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
          shell: false,
        });
        const timer = setTimeout(resolve, 1500);
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        killer.once("error", done);
        killer.once("exit", done);
      });
    }
    await session.client.close().catch(() => {});
    await killTree;
  }

  async stop() {
    await Promise.allSettled([...this.sessions.keys()].map((id) => this.close(id)));
  }

  async connection(input, signal) {
    const config = mcpConfig(input);
    const fingerprint = JSON.stringify(config);
    let session = this.sessions.get(config.id);
    if (session && session.fingerprint !== fingerprint) {
      await this.close(config.id);
      session = null;
    }
    if (!session) {
      const controller = new AbortController();
      const changed = () => {
        if (this.sessions.get(config.id)?.controller !== controller) return;
        this.emit({ server: config.id, kind: "catalog", connectionToken: config.connectionToken });
      };
      const client = new Client(
        { name: "anvil", version: this.version },
        {
          capabilities: {},
          versionNegotiation: {
            mode: "auto",
            probe: { timeoutMs: Math.min(config.timeoutMs, 8000), maxRetries: 0 },
          },
          inputRequired: { autoFulfill: false },
          listChanged: {
            tools: { autoRefresh: false, onChanged: changed },
            resources: { autoRefresh: false, onChanged: changed },
          },
        },
      );
      session = {
        client,
        transport: null,
        controller,
        fingerprint,
        config,
        ready: null,
        outputs: new Set(),
      };
      this.sessions.set(config.id, session);
      const owned = session;
      client.onclose = () => {
        if (this.sessions.get(config.id) !== owned) return;
        this.sessions.delete(config.id);
        controller.abort();
        this.emit({ server: config.id, kind: "closed", connectionToken: config.connectionToken });
      };
      client.fallbackNotificationHandler = async (note) => {
        if (owned.outputs.size === 1) for (const emit of owned.outputs) emit?.(note.params || {});
      };
      session.ready = (async () => {
        let stderr = "";
        const abort = () => {
          void this.close(config.id);
        };
        signal?.addEventListener("abort", abort, { once: true });
        try {
          const provider =
            config.auth === "oauth"
              ? await this.oauth?.provider(config, undefined, controller.signal)
              : undefined;
          owned.provider = provider;
          controller.signal.throwIfAborted();
          signal?.throwIfAborted();
          const transport =
            config.transport === "stdio"
              ? new StdioClientTransport({
                  command: config.command,
                  args: config.args || [],
                  cwd: config.cwd || undefined,
                  env: { ...getDefaultEnvironment(), ...config.env },
                  stderr: "pipe",
                  maxBufferSize: 32 * 1024 * 1024,
                })
              : new StreamableHTTPClientTransport(new URL(config.url), {
                  requestInit: { headers: config.headers },
                  authProvider: provider,
                  fetch: (input, init) =>
                    mcpFetch(input, {
                      ...init,
                      signal: AbortSignal.any([
                        controller.signal,
                        ...(init?.signal ? [init.signal] : []),
                      ]),
                    }),
                  reconnectionOptions: {
                    maxRetries: 0,
                    initialReconnectionDelay: 1000,
                    maxReconnectionDelay: 1000,
                    reconnectionDelayGrowFactor: 1,
                  },
                });
          owned.transport = transport;
          transport.stderr?.on("data", (data) => {
            stderr = (stderr + String(data)).slice(-3000);
          });
          await client.connect(transport, {
            signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
            timeout: config.timeoutMs,
          });
        } catch (error) {
          if (this.sessions.get(config.id) === owned) await this.close(config.id);
          if (signal?.aborted) throw signal.reason;
          if (stderr && /closed|spawn|ENOENT|connect/i.test(error.message))
            throw new Error(`${error.message}\n${stderr}`);
          throw error;
        } finally {
          signal?.removeEventListener("abort", abort);
        }
      })();
    }
    await session.ready;
    signal?.throwIfAborted();
    return session;
  }

  async request(config, method, params = {}, { signal, onProgress } = {}) {
    signal?.throwIfAborted();
    const session = await this.connection(config, signal);
    const { client, controller } = session;
    const options = {
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      timeout: session.config.timeoutMs,
      resetTimeoutOnProgress: false,
      onprogress: onProgress,
      cacheMode: "refresh",
    };
    session.outputs.add(onProgress);
    try {
      switch (method) {
        case "initialize":
          return {
            capabilities: client.getServerCapabilities() || {},
            protocolVersion: client.getNegotiatedProtocolVersion(),
            serverInfo: client.getServerVersion(),
          };
        case "tools/list":
          return await client.listTools(params, options);
        case "resources/list":
          return await client.listResources(params, options);
        case "resources/templates/list":
          return await client.listResourceTemplates(params, options);
        case "resources/read":
          return await client.readResource(params, options);
        // SDK validation and transport errors propagate. Never replay a tool call
        // after a lost session or ambiguous network failure.
        case "tools/call":
          return await client.callTool(params, options);
        default:
          throw new Error(`MCP-Methode nicht unterstützt: ${method}`);
      }
    } finally {
      session.outputs.delete(onProgress);
    }
  }
}
