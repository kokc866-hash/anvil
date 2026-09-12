// Local OAuth/MCP server for desktop acceptance tests. No external account or model.
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";

export async function startServiceFixture() {
  const state = {
    requests: [], calls: [], registrations: 0, authorizations: 0,
    tokenExchanges: 0, pkceVerified: 0, failTools: false, holdTokens: false,
    heldTokens: [], note: "Notiz aus dem echten lokalen MCP-Testserver.",
    errors: [],
  };
  const clients = new Map(), codes = new Map(), tokens = new Set();
  let base;
  const read = async req => { let body = ""; for await (const chunk of req) body += chunk; return body; };
  const server = createServer((req, res) => {
    const json = (value, status = 200, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
      res.end(JSON.stringify(value));
    };
    void (async () => {
      const url = new URL(req.url, base);
      state.requests.push({ path: url.pathname, method: req.method });
      if (url.pathname.startsWith("/.well-known/oauth-protected-resource"))
        return json({ resource: `${base}/mcp`, authorization_servers: [base] });
      if (url.pathname.startsWith("/.well-known/oauth-authorization-server"))
        return json({ issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"] });
      if (url.pathname === "/register" && req.method === "POST") {
        const metadata = JSON.parse(await read(req));
        if (!metadata.redirect_uris?.every(raw => { const u = new URL(raw); return u.protocol === "http:" && u.hostname === "127.0.0.1" && u.pathname === "/callback"; }))
          return json({ error: "invalid_redirect_uri" }, 400);
        const client_id = `qa-client-${randomUUID()}`;
        clients.set(client_id, metadata); state.registrations++;
        return json({ ...metadata, client_id }, 201);
      }
      if (url.pathname === "/authorize") {
        const p = url.searchParams, client = clients.get(p.get("client_id"));
        if (!client?.redirect_uris.includes(p.get("redirect_uri")) || !p.get("state") || p.get("code_challenge_method") !== "S256" || !p.get("code_challenge"))
          return json({ error: "invalid_request" }, 400);
        const code = randomUUID(); codes.set(code, Object.fromEntries(p)); state.authorizations++;
        const callback = new URL(p.get("redirect_uri"));
        callback.searchParams.set("code", code); callback.searchParams.set("state", p.get("state")); callback.searchParams.set("iss", base);
        res.writeHead(302, { location: callback.href }); res.end(); return;
      }
      if (url.pathname === "/token" && req.method === "POST") {
        const form = new URLSearchParams(await read(req)), code = codes.get(form.get("code"));
        if (form.get("grant_type") !== "authorization_code" || !code || code.client_id !== form.get("client_id") || code.redirect_uri !== form.get("redirect_uri") || createHash("sha256").update(form.get("code_verifier") || "").digest("base64url") !== code.code_challenge)
          return json({ error: "invalid_grant" }, 400);
        codes.delete(form.get("code")); state.pkceVerified++; state.tokenExchanges++;
        if (state.holdTokens) await new Promise(resolve => state.heldTokens.push(resolve));
        const access_token = `qa-access-${randomUUID()}`; tokens.add(access_token);
        return json({ access_token, refresh_token: `qa-refresh-${randomUUID()}`, token_type: "Bearer", expires_in: 3600 });
      }
      if (url.pathname === "/mcp") {
        if (!tokens.has((req.headers.authorization || "").replace(/^Bearer /, "")))
          return json({}, 401, { "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` });
        if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
        const message = JSON.parse(await read(req));
        if (message.id == null) { res.writeHead(202); res.end(); return; }
        const result = value => json({ jsonrpc: "2.0", id: message.id, result: value });
        const error = (code, messageText) => json({ jsonrpc: "2.0", id: message.id, error: { code, message: messageText } });
        if (message.method === "initialize") return result({ protocolVersion: "2025-03-26", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "anvil-service-fixture", version: "1" } });
        if (message.method === "tools/list") {
          if (state.failTools) return error(-32603, "Fixture catalog unavailable");
          return result({ tools: [
            { name: "read_note", description: "Testnotiz lesen", annotations: { readOnlyHint: true }, inputSchema: { type: "object", properties: {}, additionalProperties: false } },
            { name: "update_note", description: "Testnotiz ändern", annotations: { readOnlyHint: false }, inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
          ] });
        }
        if (message.method === "tools/call") {
          state.calls.push(structuredClone(message.params));
          if (message.params.name === "update_note") state.note = String(message.params.arguments?.text);
          else if (message.params.name !== "read_note") return error(-32602, "Unknown tool");
          return result({ content: [{ type: "text", text: state.note }] });
        }
        if (message.method === "resources/list") return result({ resources: [{ uri: "fixture://note", name: "Testnotiz", mimeType: "text/plain" }] });
        if (message.method === "resources/templates/list") return result({ resourceTemplates: [] });
        if (message.method === "resources/read") return result({ contents: [{ uri: "fixture://note", text: state.note, mimeType: "text/plain" }] });
        return error(-32601, "Method not found");
      }
      return json({ error: "not_found" }, 404);
    })().catch(error => { state.errors.push(error.message); if (!res.headersSent) json({ error: error.message }, 500); else res.end(); });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  return { base, url: `${base}/mcp`, state, releaseTokens() { state.holdTokens = false; for (const resolve of state.heldTokens.splice(0)) resolve(); }, close() { for (const resolve of state.heldTokens.splice(0)) resolve(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); } };
}
