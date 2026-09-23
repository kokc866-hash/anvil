import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function serviceFixture() {
  const state = { calls: [], requests: [], held: [], mode: "normal", badAuth: 0 };
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer fixture-access") {
      state.badAuth++;
      res.writeHead(401).end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(req.method === "DELETE" ? 200 : 405).end();
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const msg = JSON.parse(raw);
    state.requests.push(msg);
    const reply = (result) =>
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
    const unsupported = () =>
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            error: { code: -32601, message: "Method not found" },
          }),
        );
    if (msg.method === "server/discover") return unsupported();
    if (msg.method === "initialize")
      return reply({
        protocolVersion: "2025-03-26",
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "fixture", version: "1" },
      });
    if (msg.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    if (msg.method === "tools/list")
      return reply({
        tools: [
          {
            name: msg.params?.cursor ? "forbidden" : "record",
            description: "Record one test value",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
              additionalProperties: false,
            },
          },
        ],
        ...(msg.params?.cursor ? {} : { nextCursor: "second" }),
      });
    if (msg.method === "resources/list")
      return reply({ resources: [{ name: "Fixture document", uri: "fixture://document" }] });
    if (msg.method === "resources/templates/list")
      return reply({
        resourceTemplates: [{ name: "Fixture template", uriTemplate: "fixture://document/{id}" }],
      });
    if (msg.method === "resources/read")
      return reply({ contents: [{ uri: msg.params.uri, text: "RESOURCE_OK" }] });
    if (msg.method === "tools/call") {
      state.calls.push(msg.params);
      if (state.mode === "disconnect") {
        req.socket.destroy();
        return;
      }
      const done = () =>
        reply({
          content: [{ type: "text", text: "SERVICE_OK " + msg.params.arguments.text }],
          structuredContent: { recorded: true },
        });
      if (state.mode === "hold") state.held.push({ done, res });
      else done();
      return;
    }
    unsupported();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  return {
    state,
    url,
    config: {
      id: "anvil-service:fixture",
      name: "Testdienst",
      service: "custom",
      transport: "http",
      auth: "oauth",
      enabled: true,
      url,
      allowedTools: ["record"],
      allowResources: true,
    },
    release() {
      for (const item of state.held.splice(0)) item.done();
    },
    async close() {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}

// An isolated npm-style CLI fixture. It never authenticates against a real service.
export async function installCliFixture(root) {
  const dir = join(root, "node_modules", "@anthropic-ai", "claude-code");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify({ bin: { claude: "fixture.cjs" } }));
  await writeFile(
    join(root, "claude"),
    '#!/usr/bin/env node\nrequire("./node_modules/@anthropic-ai/claude-code/fixture.cjs");\n',
    { mode: 0o755 },
  );
  await writeFile(
    join(dir, "fixture.cjs"),
    `const fs=require('fs'),path=require('path');
const root=${JSON.stringify(root)}, args=process.argv.slice(2);
if(args.includes('--version')){console.log('fixture-cli 1.0');process.exit(0);}
if(args[0]==='auth'){console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai'}));process.exit(0);}
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>input+=x);
process.stdin.on('end',()=>{
  fs.appendFileSync(path.join(root,'cli-calls.jsonl'),JSON.stringify({pid:process.pid,args,input,thinking:process.env.MAX_THINKING_TOKENS})+'\\n');
  fs.writeFileSync(path.join(root,'cli.pid'),String(process.pid));
  const send=()=>{let choice=JSON.parse(fs.readFileSync(path.join(root,'cli-choice.json'),'utf8'));if(Array.isArray(choice)){const n=fs.readFileSync(path.join(root,'cli-calls.jsonl'),'utf8').trim().split('\\n').length;choice=choice[Math.min(n-1,choice.length-1)];}console.log(JSON.stringify({type:'result',result:JSON.stringify(choice)}));};
  if(fs.existsSync(path.join(root,'cli-hold'))){const timer=setInterval(()=>{if(!fs.existsSync(path.join(root,'cli-hold'))){clearInterval(timer);send();}},40);}else send();
});`,
  );
  return root;
}
