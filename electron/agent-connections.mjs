import { McpHost, mcpConfig } from "./mcp-host.mjs";
import { completeCli } from "./cli-runner.mjs";

const contract = () => import("../agent-build/service-contract.mjs");
const identity = (s) =>
  JSON.stringify([
    s.id,
    s.url,
    s.transport,
    s.command,
    s.args,
    s.cwd,
    s.auth,
    s.oauthClientId,
    s.service,
    s.context,
    s.headers,
    s.env,
    s.allowedTools,
    s.allowResources,
  ]);

/** One set of connections belongs to the background job, never its viewer. */
export class AgentConnections {
  constructor({ mcp = new McpHost(), cli = completeCli } = {}) {
    this.mcp = mcp;
    this.cli = cli;
    this.servers = [];
    this.catalog = new Map();
  }
  begin(request) {
    this.surface = request.surface;
    this.servers = (request.services || [])
      .filter(
        (s) =>
          s.enabled &&
          (!this.surface?.id ||
            this.surface.id === "anvil" ||
            this.surface.mode === "bridge" ||
            s.id === this.surface.id),
      )
      .map(mcpConfig);
    if (
      this.servers.length > 64 ||
      new Set(this.servers.map((s) => s.id)).size !== this.servers.length
    )
      throw new Error("Ungültige Dienstauswahl.");
    this.model = request.model;
    this.catalog.clear();
  }
  samePermissions(services, surface) {
    if (this.surface && JSON.stringify(surface) !== JSON.stringify(this.surface)) return false;
    // A running job can never gain a newly added server or wider tool grant.
    return this.servers.every((s) => {
      const live = services.find((x) => x.id === s.id && x.enabled);
      return live && identity(mcpConfig(live)) === identity(s);
    });
  }
  async execute(op, { signal, emit }) {
    if (op.kind === "cli") {
      if (!this.model.cliKind) throw new Error("Keine CLI für diesen Auftrag gewählt.");
      return this.cli(
        {
          kind: this.model.cliKind,
          model: this.model.model,
          thinking: this.model.thinking,
          prompt: op.prompt,
          images: op.images || [],
        },
        { signal, timeoutMs: this.model.hardStopMin * 60000, onText: (text) => emit?.(text) },
      );
    }
    const policy = await contract();
    signal.throwIfAborted();
    const selected = op.server
      ? this.servers.filter((s) => s.id === op.server || s.name === op.server)
      : this.servers;
    if (op.server && selected.length !== 1)
      throw new Error("Dienst fehlt oder Name ist mehrdeutig. Dienst-ID aus mcp_list verwenden.");
    const permitted = (s, method, params) => policy.assertConnectionRequest(s, method, params);
    const load = async (s) => {
      if (this.catalog.has(s.id)) return this.catalog.get(s.id);
      permitted(s, "tools/list");
      const tools = [];
      let catalogBytes = 0;
      let cursor;
      const seen = new Set();
      for (let page = 0; page < 64; page++) {
        const value = await this.mcp.request(s, "tools/list", cursor ? { cursor } : {}, { signal });
        catalogBytes += Buffer.byteLength(JSON.stringify(value));
        if (catalogBytes > 8 * 1024 * 1024)
          throw new Error("Dienstkatalog zu groß (höchstens 8 MiB).");
        for (const tool of value.tools || []) {
          try {
            permitted(s, "tools/call", { name: tool.name });
          } catch {
            continue;
          }
          tools.push({ ...tool, server: s.name, serverId: s.id });
        }
        if (!value.nextCursor) {
          cursor = undefined;
          break;
        }
        if (seen.has(value.nextCursor)) throw new Error("Dienst wiederholt seinen Katalog-Cursor.");
        seen.add(value.nextCursor);
        cursor = value.nextCursor;
      }
      if (cursor) throw new Error("Dienstkatalog überschreitet die Seitengrenze.");
      this.catalog.set(s.id, tools);
      return tools;
    };
    if (op.action === "list") {
      const rows = [],
        servers = [],
        resources = [],
        resourceTemplates = [];
      for (const s of selected) {
        try {
          if (!op.args?.cursor) this.catalog.delete(s.id);
          rows.push(...(await load(s)));
          servers.push({ id: s.id, name: s.name, ready: true });
        } catch (error) {
          signal.throwIfAborted();
          servers.push({
            id: s.id,
            name: s.name,
            ready: false,
            error: String(error.message || error),
          });
        }
        // Discover only resources the user has allowed the job to read.
        try {
          permitted(s, "resources/read", {});
        } catch {
          continue;
        }
        for (const [method, key, target] of [
          ["resources/list", "resources", resources],
          ["resources/templates/list", "resourceTemplates", resourceTemplates],
        ]) {
          let cursor;
          let catalogBytes = 0;
          const seen = new Set();
          try {
            permitted(s, method, {});
            for (let page = 0; page < 64; page++) {
              const value = await this.mcp.request(s, method, cursor ? { cursor } : {}, { signal });
              catalogBytes += Buffer.byteLength(JSON.stringify(value));
              if (catalogBytes > 8 * 1024 * 1024)
                throw new Error("Ressourcenkatalog zu groß (höchstens 8 MiB).");
              target.push(
                ...(value[key] || []).map((row) => ({ ...row, server: s.name, serverId: s.id })),
              );
              if (!value.nextCursor) {
                cursor = undefined;
                break;
              }
              if (seen.has(value.nextCursor))
                throw new Error("Dienst wiederholt seinen Ressourcen-Cursor.");
              seen.add(value.nextCursor);
              cursor = value.nextCursor;
            }
            if (cursor) throw new Error("Ressourcenkatalog überschreitet die Seitengrenze.");
          } catch (error) {
            signal.throwIfAborted();
            if (![-32601, -32004].includes(error.code))
              servers.find((row) => row.id === s.id).resourceError = String(error.message || error);
          }
        }
      }
      const options = op.args || {},
        q = String(options.query || "").toLowerCase();
      const filtered = rows.filter((t) =>
        `${t.name} ${t.description || ""} ${t.server}`.toLowerCase().includes(q),
      );
      const offset = Number(options.cursor || 0),
        limit = Math.min(40, Math.max(1, Math.floor(Number(options.limit) || 12)));
      if (!Number.isSafeInteger(offset) || offset < 0)
        throw new Error("Ungültiger Katalog-Cursor.");
      return {
        tools: filtered.slice(offset, offset + limit),
        resources: resources.slice(offset, offset + limit),
        resourceTemplates: resourceTemplates.slice(offset, offset + limit),
        servers,
        total: filtered.length,
        nextCursor:
          offset + limit < Math.max(filtered.length, resources.length, resourceTemplates.length)
            ? String(offset + limit)
            : undefined,
        hint: "mcp_call mit server=serverId und exaktem name. Freigegebene Ressourcen können über mcp_read_resource gelesen werden. Bei einem unbestätigten Dienstaufruf nicht automatisch erneut aufrufen.",
      };
    }
    const s = selected.length === 1 ? selected[0] : null;
    if (!s) throw new Error("Dienst-ID fehlt. mcp_list verwenden.");
    if (op.action === "read") {
      if (typeof op.name !== "string" || !op.name.trim())
        throw new Error("Ressourcenadresse fehlt.");
      permitted(s, "resources/read", { uri: op.name });
      return policy.unwrapMcp(
        await this.mcp.request(s, "resources/read", { uri: op.name }, { signal }),
      );
    }
    if (op.action !== "call") throw new Error("Unbekannte Dienstaktion.");
    permitted(s, "tools/call", { name: op.name });
    const tool = (await load(s)).find((t) => t.name === op.name);
    if (!tool) throw new Error("Werkzeug nicht im freigegebenen Katalog.");
    const args = policy.mcpArguments(tool.inputSchema, op.args, s.context);
    // No retry on ambiguous transport failure: the remote effect may already exist.
    return policy.unwrapMcp(
      await this.mcp.request(s, "tools/call", { name: op.name, arguments: args }, { signal }),
    );
  }
  close() {
    this.catalog.clear();
    return this.mcp.stop();
  }
}
