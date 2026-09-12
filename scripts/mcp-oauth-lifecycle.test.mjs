import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { McpOAuth, oauthKey } from "../electron/mcp-oauth.mjs";
import { mcpConfig } from "../electron/mcp-host.mjs";

const config = {
  id: "service",
  transport: "http",
  auth: "oauth",
  url: "https://service.example/mcp",
};
const issuer = "https://auth.example";
const credentials = {
  access_token: "test-access",
  refresh_token: "test-refresh",
  token_type: "Bearer",
  expires_in: 3600,
};

test("native MCP accepts namespaced service and curated package IDs", () => {
  for (const id of [
    "anvil-pack:github-repos-readonly:v1",
    "anvil-service:1234-abcd",
    "custom-server",
  ])
    assert.equal(mcpConfig({ ...config, id }).id, id);
  for (const id of ["../service", "service/file", "service\\file", "service\n", ""])
    assert.throws(() => mcpConfig({ ...config, id }), /Server-Id/);
});
function storage(overrides = {}) {
  const records = new Map();
  const options = {
    read: async (key) => structuredClone(records.get(key)),
    write: async (key, value) =>
      value === undefined ? records.delete(key) : records.set(key, structuredClone(value)),
    open: async () => {},
    ...overrides,
  };
  return { records, options, oauth: new McpOAuth(options) };
}
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test("OAuth status survives restart without exposing credentials, logout clears all issuers", async () => {
  const { oauth, records, options } = storage();
  assert.deepEqual(await oauth.status(config), { authenticated: false });
  const provider = await oauth.provider(config);
  await provider.saveTokens(credentials, { issuer });
  await provider.saveTokens(credentials, { issuer: "https://other.example" });
  assert.deepEqual(await new McpOAuth(options).status(config), { authenticated: true });
  assert.deepEqual(await oauth.logout(config), { authenticated: false });
  assert.equal(records.has(oauthKey(config)), false);
  assert.deepEqual(await new McpOAuth(options).status(config), { authenticated: false });
  assert.throws(() => provider.tokens(), /getrennt/);
  await assert.rejects(provider.saveTokens(credentials, { issuer }), /getrennt/);
  await assert.rejects(
    provider.saveClientInformation({ client_id: "late" }, { issuer }),
    /getrennt/,
  );
});

test("OAuth logout wins over a credential write already in progress", async () => {
  const started = deferred(),
    release = deferred();
  const { oauth, records } = storage({
    write: async (key, value) => {
      if (value) {
        started.resolve();
        await release.promise;
        records.set(key, value);
      } else records.delete(key);
    },
  });
  const provider = await oauth.provider(config);
  const saving = provider.saveTokens(credentials, { issuer });
  const rejected = assert.rejects(saving, /getrennt/);
  await started.promise;
  const logout = oauth.logout(config);
  release.resolve();
  await Promise.all([logout, rejected]);
  assert.deepEqual(await oauth.status(config), { authenticated: false });
  assert.equal(records.size, 0);
});

test("OAuth prevents a provider acquired across logout and canceled refresh from writing", async () => {
  const started = deferred(),
    release = deferred();
  let delayed = true;
  const { oauth } = storage({
    read: async () => {
      if (delayed) {
        delayed = false;
        started.resolve();
        await release.promise;
      }
    },
  });
  const loading = oauth.provider(config);
  const rejected = assert.rejects(loading, /getrennt/);
  await started.promise;
  await oauth.logout(config);
  release.resolve();
  await rejected;
  const controller = new AbortController();
  const provider = await oauth.provider(config, undefined, controller.signal);
  controller.abort();
  await assert.rejects(provider.saveTokens(credentials, { issuer }), /abort/i);
  assert.deepEqual(await oauth.status(config), { authenticated: false });
});

test("OAuth status distinguishes expired access-only tokens and refreshable accounts", async () => {
  const { oauth } = storage();
  const provider = await oauth.provider(config);
  await provider.saveTokens(
    { ...credentials, refresh_token: undefined, expires_in: -1 },
    { issuer },
  );
  assert.deepEqual(await oauth.status(config), { authenticated: false });
  await provider.saveTokens({ ...credentials, expires_in: -1 }, { issuer });
  assert.deepEqual(await oauth.status(config), { authenticated: true });
  await provider.invalidateCredentials("tokens");
  assert.deepEqual(await oauth.status(config), { authenticated: false });
});

test("OAuth browser opens only secure or loopback URLs without embedded credentials", async () => {
  const opened = [];
  const { oauth } = storage({ open: async (url) => opened.push(url) });
  const provider = await oauth.provider(config, { url: "http://127.0.0.1:1234/callback" });
  for (const raw of [
    "file:///tmp/login",
    "javascript:alert(1)",
    "http://auth.example/login",
    "https://user:secret@auth.example/login",
    "https://auth.example/#token",
  ])
    await assert.rejects(provider.redirectToAuthorization(new URL(raw)), /Unsichere/);
  assert.equal(opened.length, 0);
  await provider.redirectToAuthorization(new URL("https://auth.example/login"));
  await provider.redirectToAuthorization(new URL("http://127.0.0.1:1234/login"));
  assert.equal(opened.length, 2);
});

async function authServer(t, tokenHandler) {
  let base;
  const server = createServer((req, res) => {
    const json = (value, status = 200, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(value));
    };
    void (async () => {
      const url = new URL(req.url, base);
      if (url.pathname.includes(".well-known/oauth-protected-resource"))
        return json({ resource: `${base}/mcp`, authorization_servers: [base] });
      if (url.pathname.includes(".well-known/oauth-authorization-server"))
        return json({
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
        });
      if (url.pathname === "/register") {
        let data = "";
        for await (const chunk of req) data += chunk;
        return json({ ...JSON.parse(data), client_id: "fixture-client" }, 201);
      }
      if (url.pathname === "/token") return tokenHandler(json);
      if (url.pathname === "/mcp")
        return json({}, 401, {
          "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
        });
      return json({}, 404);
    })().catch((error) => json({ error: error.message }, 500));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { ...config, url: `${base}/mcp` };
}

for (const mode of ["cancel", "logout"])
  test(`OAuth ${mode} during token exchange cannot restore credentials from late response`, async (t) => {
    const started = deferred(),
      release = deferred(),
      callback = deferred();
    const service = await authServer(t, async (json) => {
      started.resolve();
      await release.promise;
      json(credentials);
    });
    const { oauth, records } = storage({
      open: async (raw) => {
        const url = new URL(raw),
          redirect = new URL(url.searchParams.get("redirect_uri"));
        redirect.searchParams.set("state", url.searchParams.get("state"));
        redirect.searchParams.set("code", "fixture-code");
        redirect.searchParams.set("iss", url.origin);
        callback.resolve(redirect.href);
        assert.equal((await fetch(redirect)).status, 200);
      },
    });
    const controller = new AbortController();
    const login = oauth.login(service, controller.signal);
    const rejected = assert.rejects(login);
    await started.promise;
    if (mode === "cancel") controller.abort();
    else await oauth.logout(service);
    release.resolve();
    await rejected;
    assert.equal(records.size, 0);
    assert.deepEqual(await oauth.status(service), { authenticated: false });
    await assert.rejects(fetch(await callback.promise), /fetch failed/);
  });

test("OAuth cancellation while the browser is open closes the callback and clears registration", async (t) => {
  const opened = deferred();
  let exchanges = 0;
  const service = await authServer(t, (json) => {
    exchanges++;
    json(credentials);
  });
  const { oauth, records } = storage({ open: async (raw) => opened.resolve(new URL(raw)) });
  const controller = new AbortController();
  const login = oauth.login(service, controller.signal);
  const rejected = assert.rejects(login);
  const authorization = await opened.promise;
  controller.abort();
  await rejected;
  assert.equal(exchanges, 0);
  assert.equal(records.size, 0);
  await assert.rejects(fetch(authorization.searchParams.get("redirect_uri")), /fetch failed/);
});

test("OAuth resumes the same browser authorization and reports progress without secrets", async (t) => {
  const opened = deferred(),
    urls = [],
    progress = [];
  const service = await authServer(t, (json) => json(credentials));
  const { oauth } = storage({
    open: async (raw) => {
      urls.push(raw);
      if (urls.length === 1) return opened.resolve();
      const url = new URL(raw),
        callback = new URL(url.searchParams.get("redirect_uri"));
      callback.searchParams.set("state", url.searchParams.get("state"));
      callback.searchParams.set("code", "fixture-code");
      callback.searchParams.set("iss", url.origin);
      assert.equal((await fetch(callback)).status, 200);
    },
  });
  const login = oauth.login(service, undefined, (message) => progress.push(message));
  await opened.promise;
  assert.match(progress.join(" "), /Warte auf die Freigabe/);
  assert.deepEqual(await oauth.reopen(service), { opened: true });
  assert.deepEqual(await login, { authenticated: true });
  assert.equal(urls.length, 2);
  assert.equal(urls[0], urls[1], "resume must preserve registration, state and PKCE challenge");
  assert.match(progress.join(" "), /Rückmeldung vom Browser empfangen/);
  assert.doesNotMatch(progress.join(" "), /https?:|fixture-code|test-access|test-refresh/);
  await assert.rejects(oauth.reopen(service), /Keine wartende/);
});

test("OAuth missing browser callback has a distinct timeout and removes pending authorization", async (t) => {
  let authorization;
  const service = await authServer(t, () => assert.fail("must not exchange without consent"));
  const { oauth, records } = storage({
    loginTimeoutMs: 500,
    open: async (raw) => {
      authorization = new URL(raw);
    },
  });
  await assert.rejects(oauth.login(service), /Keine Rückmeldung vom Browser/);
  assert.ok(authorization);
  assert.equal(records.size, 0);
  await assert.rejects(oauth.reopen(service), /Keine wartende/);
  await assert.rejects(fetch(authorization.searchParams.get("redirect_uri")), /fetch failed/);
});

test("OAuth failed credential deletion is reported and never claims successful logout", async () => {
  let rejectDelete = false;
  const { oauth, records } = storage({
    write: async (key, value) => {
      if (value === undefined && rejectDelete) throw new Error("Vault locked");
      if (value === undefined) records.delete(key);
      else records.set(key, value);
    },
  });
  const provider = await oauth.provider(config);
  await provider.saveTokens(credentials, { issuer });
  rejectDelete = true;
  await assert.rejects(oauth.logout(config), /Vault locked/);
  assert.throws(() => provider.tokens(), /getrennt/);
  rejectDelete = false;
  assert.deepEqual(await oauth.logout(config), { authenticated: false });
  assert.equal(records.size, 0);
});
