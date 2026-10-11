import Ajv from "ajv";

export const SORCERESS_BASE = "https://sorceress.games/api/v1";
const jobTool = {
  name: "sorceress_job_get",
  description:
    "Status und Ergebnis eines Sorceress-Medienauftrags einmalig abfragen (kostenlos). jobId aus der ursprünglichen Antwort verwenden. Bei queued/processing ist die Generierung noch nicht fertig. Den Erzeugungsaufruf nicht wiederholen. Abbruch in Anvil beendet nur das Warten; die API dokumentiert keinen serverseitigen Abbruch.",
  inputSchema: {
    type: "object",
    properties: { jobId: { type: "string", pattern: "^[A-Za-z0-9_-]{1,160}$" } },
    required: ["jobId"],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};
const infoTool = {
  name: "sorceress_tool_info",
  description:
    "Vollständige Anbieterbeschreibung, Modelle, Parameter und Credit-Preise eines Sorceress-Werkzeugs aus dem aktuellen Katalog lesen (kostenlos). Vor kostenpflichtiger Generierung die passenden Optionen prüfen.",
  inputSchema: {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};
const identifier = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const unsafeName = (name) => ["__proto__", "constructor", "prototype"].includes(name);

export function assertSorceressConfig(config) {
  if (config.url !== SORCERESS_BASE || config.transport !== "http" || config.auth !== "bearer")
    throw new Error(
      "Sorceress benötigt die feste API-Adresse und einen API-Schlüssel. Verbindung unter Erweiterungen → Dienste neu hinzufügen.",
    );
}

function catalogTool(tool) {
  if (
    !identifier.test(tool.id) ||
    unsafeName(tool.id) ||
    [jobTool.name, infoTool.name].includes(tool.id)
  )
    throw new Error("Sorceress: ungültige Werkzeugkennung im Katalog.");
  if (!Array.isArray(tool.params)) throw new Error("Sorceress: Parameterschema fehlt.");
  const properties = {},
    required = [];
  for (const param of tool.params) {
    if (
      !identifier.test(param.name) ||
      unsafeName(param.name) ||
      Object.hasOwn(properties, param.name) ||
      !["string", "number", "integer", "boolean", "array", "object"].includes(param.type)
    )
      throw new Error("Sorceress: ungültiges Parameterschema.");
    properties[param.name] = {
      type: param.type,
      ...(param.description ? { description: String(param.description) } : {}),
      ...(param.type === "array" ? { items: {} } : {}),
    };
    if (Array.isArray(param.enum)) properties[param.name].enum = param.enum;
    if (param.required) required.push(param.name);
  }
  const cost = tool.selfBilled
    ? `Credit-Kosten: ${tool.costNote || "abhängig von Modell und Optionen; vorab sorceress_tool_info lesen."}`
    : typeof tool.creditCost === "number"
      ? `Credit-Kosten laut Katalog: ${tool.creditCost}.`
      : "Credit-Kosten vorab mit sorceress_tool_info prüfen.";
  return {
    name: tool.id,
    title: String(tool.label || tool.id),
    description: [
      String(tool.description || tool.label || tool.id),
      cost,
      "Wenn die Antwort eine Medien-jobId enthält: Fortschritt mit sorceress_job_get prüfen; der Erzeugungsaufruf startet einen neuen Auftrag.",
    ].join("\n"),
    inputSchema: { type: "object", properties, required, additionalProperties: false },
  };
}

// A REST adapter behind Anvil's existing MCP host, not a claimed vendor MCP endpoint.
// No generation is started by connect/list; no request is automatically replayed.
export class SorceressClient {
  constructor(config, send) {
    assertSorceressConfig(config);
    this.config = config;
    this.send = send;
    this.catalog = null;
    this.tools = [];
    this.validators = new Map();
    this.ajv = new Ajv({ strict: false, allErrors: true });
  }
  async json(route, { method = "GET", body, signal, timeout = this.config.timeoutMs } = {}) {
    const authorization = this.config.headers.authorization || this.config.headers.Authorization;
    if (!/^Bearer \S+$/.test(authorization || ""))
      throw new Error("Sorceress: API-Schlüssel fehlt. Unter Erweiterungen → Dienste speichern.");
    const response = await this.send(`${SORCERESS_BASE}${route}`, {
      method,
      headers: {
        authorization,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
        : AbortSignal.timeout(timeout),
    });
    // Bound catalog/tool output size before decoding; never echo an HTML page or credential.
    const reader = response.body?.getReader(),
      parts = [];
    let size = 0;
    try {
      if (reader)
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 4 * 1024 * 1024) throw new Error("Sorceress: Antwort größer als 4 MiB.");
          parts.push(Buffer.from(value));
        }
    } finally {
      await reader?.cancel().catch(() => {});
    }
    signal?.throwIfAborted();
    const raw = Buffer.concat(parts).toString("utf8");
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(
        `Sorceress: HTTP ${response.status} · ${/^\s*</.test(raw) ? "HTML statt API-Antwort" : "ungültige JSON-Antwort"}.`,
      );
    }
    if (!response.ok || data?.ok === false) {
      const reason = {
        401: "API-Schlüssel fehlt, ist ungültig oder wurde widerrufen.",
        402: "Guthaben reicht nicht aus.",
        403: "Der API-Schlüssel erlaubt dieses Werkzeug nicht.",
        404: "Werkzeug oder Auftrag nicht gefunden.",
        409: "Dieses Werkzeug ist derzeit nicht verfügbar.",
      }[response.status];
      let detail =
        reason ||
        String(
          data?.error?.message || data?.error || data?.message || "Dienst meldet einen Fehler.",
        );
      for (const value of [authorization, authorization.slice(7)])
        detail = detail.split(value).join("[Schlüssel]");
      throw new Error(
        `Sorceress: HTTP ${response.status} · ${detail.replace(/[\r\n]+/g, " ").slice(0, 350)}`,
      );
    }
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("Sorceress: ungültige API-Antwort.");
    return data;
  }
  async connect(_transport, options) {
    await this.json("/tools/ping", {
      ...options,
      method: "POST",
      body: { message: "Anvil connection check" },
    });
  }
  async close() {}
  getServerCapabilities() {
    return { tools: {} };
  }
  getNegotiatedProtocolVersion() {
    return "2025-03-26";
  }
  getServerVersion() {
    return { name: "anvil-sorceress-rest-adapter", version: "1" };
  }
  async listTools(_params, options) {
    this.catalog = null;
    this.tools = [];
    this.validators.clear();
    const catalog = await this.json("/tools", options);
    if (!Array.isArray(catalog.tools)) throw new Error("Sorceress: Werkzeugkatalog fehlt.");
    const active = catalog.tools.filter((tool) => tool.enabled === true && tool.status === "live");
    const tools = active.map(catalogTool);
    if (new Set(tools.map((tool) => tool.name)).size !== tools.length)
      throw new Error("Sorceress: doppelte Werkzeugkennung.");
    this.catalog = active;
    this.tools = [...tools, jobTool, infoTool];
    return { tools: this.tools };
  }
  async callTool(params, options) {
    if (!this.catalog) await this.listTools({}, options);
    const tool = this.tools.find((tool) => tool.name === params?.name);
    if (!tool) throw new Error("Sorceress: Werkzeug nicht im aktuellen Katalog.");
    const args = params.arguments ?? {};
    if (tool.name === jobTool.name && !/^[A-Za-z0-9_-]{1,160}$/.test(args.jobId || ""))
      throw new Error("Sorceress: ungültige Auftragskennung.");
    let validate = this.validators.get(tool.name);
    if (!validate) {
      validate = this.ajv.compile(tool.inputSchema);
      this.validators.set(tool.name, validate);
    }
    if (!validate(args))
      throw new Error(
        `Sorceress: ungültige Werkzeugargumente: ${this.ajv.errorsText(validate.errors)}`,
      );
    const result =
      tool.name === jobTool.name
        ? await this.json(`/jobs/${encodeURIComponent(args.jobId)}`, options)
        : tool.name === infoTool.name
          ? this.catalog.find((item) => item.id === args.name)
          : await this.json(`/tools/${tool.name}`, { ...options, method: "POST", body: args });
    if (!result) throw new Error("Sorceress: Werkzeug nicht im aktuellen Katalog.");
    const jobId = result.data?.jobId || result.jobId;
    const status = String(result.status || result.data?.status || "");
    const mediaJob =
      jobId && tool.name !== infoTool.name && !/^(arcade|marketplace)_/.test(tool.name);
    const pending =
      /^(queued|processing|running|pending|waiting)$/i.test(status) ||
      Boolean(mediaJob && !/^(succeeded|failed|cancelled|canceled)$/i.test(status));
    return {
      structuredContent: result,
      ...(pending ? { pending: true } : {}),
      content: [
        {
          type: "text",
          text:
            JSON.stringify(result) +
            (mediaJob && pending
              ? "\nMedienauftrag gestartet, noch kein fertiges Asset. Mit sorceress_job_get und derselben jobId prüfen; nicht erneut erzeugen."
              : ""),
        },
      ],
      ...(/^(failed|cancelled|canceled)$/i.test(status) ? { isError: true } : {}),
    };
  }
}
