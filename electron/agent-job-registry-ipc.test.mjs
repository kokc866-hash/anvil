import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { sharedAgentResourceGate } from './resource-gate.mjs';

const home = path.resolve('artifacts/cursor-adoption-2026-10-19/worktrees'); mkdirSync(home, { recursive: true });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function setup(t) {
  const area = mkdtempSync(path.join(home, 'ipc-')), handlers = new Map(), calls = [];
  const sender = Object.assign(new EventEmitter(), { id: 42, mainFrame: { url: 'https://anvil.invalid/' }, isDestroyed: () => false, send() {} });
  const event = { sender, senderFrame: sender.mainFrame };
  const f = { area, handlers, calls, sender, event, mcp: deferred(), cli: deferred(), resourceClose:deferred(),signal: null };
  class FakeMcpHost { async request(_config, method, _params, options) { f.signal = options?.signal; calls.push(['mcp', method]); return f.mcp.promise; } async stop() {} async close() {} }
  class FakeHost extends EventEmitter {
    constructor({ runtime }) { super(); this.runtime = runtime; this.state = null; }
    busy() { return this.state?.status === 'running'; }
    snapshot() { return { state: this.state }; }
    async waitForCleanup() {}
    async cleanRuntime() { calls.push(['close-resources',this.state.id]);await f.resourceClose.promise;this.runtime.engines.jobs.clear(); }
    start(request) { calls.push(['job-start', request]); this.state = { id: `job-${calls.length}`, project: request.project, status: 'running', modelTarget: request.model }; return this.snapshot(); }
    steer(...args) { calls.push(['steer', ...args]); return this.snapshot(); }
    stop() { if (this.state) this.state.status = 'stopped'; return this.snapshot(); }
    async close() { return this.stop(); }
  }
  class FakeRuntime { constructor(parts) { Object.assign(this, parts); } async execute() {} async close() {} async finish() {} }
  globalThis.__anvilJobRegistryIpc = {
    ...f, FakeMcpHost, FakeHost, FakeRuntime,
    app: { getVersion: () => 'test', getPath: () => area }, safeStorage: {}, shell: {}, utilityProcess: {},
  };
  const data = code => ({ url: `data:text/javascript,${encodeURIComponent(code)}#${path.basename(area)}`, shortCircuit: true });
  const hook = registerHooks({ resolve(specifier, context, next) {
    if (specifier === 'electron') return data('export const {app,safeStorage,shell,utilityProcess}=globalThis.__anvilJobRegistryIpc;');
    if (specifier === './ipc.mjs') return data('export const handleOnce=(name,fn)=>globalThis.__anvilJobRegistryIpc.handlers.set(name,fn);');
    if (specifier === './mcp-host.mjs') return data('export const McpHost=globalThis.__anvilJobRegistryIpc.FakeMcpHost; export const mcpConfig=value=>value;');
    if (specifier === './mcp-oauth.mjs') return data('export class McpOAuth {}');
    if (specifier === './cli-runner.mjs') return data("export const CLI_KINDS=['codex']; export async function completeCli(request,options){ const f=globalThis.__anvilJobRegistryIpc; f.calls.push(['cli',request]); f.signal=options.signal; return f.cli.promise; } export const probeCli=async()=>({ready:true}); export const loginCli=probeCli;");
    if (specifier === './cli-models.mjs') return data('export const listCliModels=async()=>[];');
    if (specifier === './agent-job-host.mjs') return data('export const AgentJobHost=globalThis.__anvilJobRegistryIpc.FakeHost;');
    if (specifier === './agent-project-runtime.mjs') return data('export const AgentProjectRuntime=globalThis.__anvilJobRegistryIpc.FakeRuntime;');
    if (specifier === './agent-preview.mjs') return data('export class AgentPreview {}');
    if (specifier === './agent-connections.mjs') return data('export class AgentConnections {samePermissions(){return true;}}');
    if (specifier === './agent-engines.mjs') return data('export class AgentEngines {constructor(){this.jobs=new Set();}}');
    if (specifier === './agent-knowledge.mjs') return data("export class AgentKnowledge {permissions(){return '';}} export const knowledgePermissions=()=>'';");
    if (specifier === './paths.mjs' && context.parentURL?.includes('/electron/')) return data('export const loadPaths=()=>({packages:globalThis.__anvilJobRegistryIpc.area});');
    return next(specifier, context);
  } });
  t.after(() => { for (const lease of sharedAgentResourceGate.snapshot()) sharedAgentResourceGate.release(lease.leaseId, lease.owner); hook.deregister(); delete globalThis.__anvilJobRegistryIpc; assert.equal(path.dirname(area), home); rmSync(area, { recursive: true, force: true }); });
  const trusted = url => url === sender.mainFrame.url;
  const mcp = await import(`./mcp-ipc.mjs?qa=${path.basename(area)}`); mcp.bindMcpIpc(trusted);
  const cli = await import(`./cli-ipc.mjs?qa=${path.basename(area)}`); cli.bindCliIpc(trusted);
  const jobs = await import(`./agent-job-ipc.mjs?qa=${path.basename(area)}`);
  f.registry = jobs.bindAgentJobIpc({ root: area, dataHome: area, isTrusted: trusted, editor: () => ({ webContents: sender }) });
  f.invoke = (name, ...args) => handlers.get(name)(event, ...args);
  return f;
}

test('terminal engine sessions can be ended explicitly without hiding results or stopping another job',async t=>{
  const f=await setup(t),request={project:f.area,model:{provider:'custom',baseUrl:'http://127.0.0.1:1/v1',model:'synthetic'}};
  const started=await f.invoke('agent-job','start',request),host=f.registry.hostFor({id:started.state.id});
  await assert.rejects(f.invoke('agent-job','close-resources',{jobId:started.jobId,id:started.state.id}),/zuerst beenden/);
  host.state.status='done';host.runtime.engines.jobs.add({done:new Promise(()=>{})});
  await assert.rejects(f.invoke('agent-job','start',request),/überlappen/);
  await assert.rejects(f.invoke('agent-job','close-resources',{id:started.state.id}),/eindeutig/);
  await assert.rejects(f.invoke('agent-job','close-resources',{jobId:started.jobId,id:'wrong-id'}),/verändert/);
  const closing=f.invoke('agent-job','close-resources',{jobId:started.jobId,id:started.state.id});
  await Promise.resolve();assert.equal(host.runtime.resourceBusy(),true);f.resourceClose.resolve();
  const closed=await closing;assert.equal(closed.state.status,'done');assert.equal(closed.state.dismissed,undefined);assert.equal(host.runtime.resourceBusy(),false);
  const next=await f.invoke('agent-job','start',request);assert.notEqual(next.state.id,started.state.id);assert.equal(f.calls.filter(c=>c[0]==='close-resources').length,1);
});

test('native MCP/CLI requests honor background ownership and hold leases until real promises settle', async t => {
  const f = await setup(t), server = { id: 'synthetic', name: 'Synthetic', transport: 'http' };
  const background = sharedAgentResourceGate.acquire('background:other');
  assert.match((await f.invoke('mcp-request', { id: 'blocked', server, method: 'tools/call' })).error, /belegt/);
  assert.match((await f.invoke('cli-run', { id: 'blocked-cli', kind: 'codex' })).error, /belegt/);
  assert.deepEqual(f.calls, []);
  sharedAgentResourceGate.release(background.leaseId, background.owner);
  const pending = f.invoke('mcp-request', { id: 'actual', server, method: 'tools/call' });
  assert.equal(f.calls.length, 1); assert.equal(sharedAgentResourceGate.held('foreground:42:renderer'), true);
  await f.invoke('mcp-cancel', 'actual');
  assert.equal(sharedAgentResourceGate.held(), true, 'cancellation request alone is not external completion');
  f.mcp.resolve({ content: [] }); await pending; assert.equal(sharedAgentResourceGate.held(), false);
  const cli = f.invoke('cli-run', { id: 'cli-actual', kind: 'codex' });
  assert.equal(f.calls.length, 2); await f.invoke('cli-cancel', 'cli-actual');
  assert.equal(sharedAgentResourceGate.held(), true);
  f.cli.resolve({ ok: true }); await cli; assert.equal(sharedAgentResourceGate.held(), false);
});

test('native renderer leases nest with its own MCP and navigation only releases UI leases', async t => {
  const f = await setup(t), api = f.handlers.get('agent-job');
  const lease = await api(f.event, 'resource-acquire', { key: 'external', owner: 'renderer' });
  const pending = f.invoke('mcp-request', { id: 'in-flight', server: { id: 'synthetic' }, method: 'tools/list' });
  assert.equal(f.calls.length, 1); assert.equal(sharedAgentResourceGate.snapshot().length, 2);
  await assert.rejects(api(f.event, 'resource-release', { leaseId: lease.leaseId, owner: 'different-session' }), /anderen Sitzung/);
  f.sender.emit('did-start-navigation', {}, 'https://anvil.invalid/', false, true);
  assert.equal(sharedAgentResourceGate.snapshot().length, 1, 'actual MCP promise still owns its lease');
  assert.throws(() => sharedAgentResourceGate.acquire('background:later'), /belegt/);
  f.mcp.resolve({ tools: [] }); await pending; assert.equal(sharedAgentResourceGate.held(), false);
});

test('job IPC selects the intended host, forwards steering exactly and rejects untrusted frames', async t => {
  const f = await setup(t), api = f.handlers.get('agent-job'), projects = [path.join(f.area, 'one'), path.join(f.area, 'two')]; projects.forEach(project => mkdirSync(project));
  const make = project => ({ project, model: { provider: 'custom', model: 'synthetic', baseUrl: 'https://model.invalid/v1' }, files: {}, messages: [{ role: 'user', content: 'No actual model.' }] });
  const a = await api(f.event, 'start', make(projects[0])), b = await api(f.event, 'start', make(projects[1]));
  await api(f.event, 'select', { jobId: a.jobId });
  const images = ['data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='];
  await api(f.event, 'steer', { jobId: b.jobId, id: b.state.id, text: 'Only second.', messageId: 'message-one', images });
  assert.deepEqual(f.calls.at(-1), ['steer', b.state.id, 'Only second.', 'message-one', images]);
  assert.equal((await api(f.event, 'jobs')).jobs.length, 2);
  assert.equal((await api(f.event, 'status', { jobId: b.jobId, id: 'old-acknowledgement' })).state.id, b.state.id);
  const stale = await api(f.event, 'select', { jobId: '', expectedJobId: b.jobId });
  assert.match(stale.error, /auswahl/i);
  assert.equal(stale.selectedJobId, a.jobId);
  assert.match((await api(f.event, 'select', { jobId: '', expectedJobId: a.jobId })).error, /aktiv/);
  f.registry.hostFor({ jobId: a.jobId }).state.status = 'done';
  const detached = await api(f.event, 'select', { jobId: '', expectedJobId: a.jobId });
  assert.equal(detached.state, null);
  assert.equal(detached.selectedJobId, '');
  assert.equal((await api(f.event, 'status')).state, null);
  assert.equal((await api(f.event, 'status', { jobId: b.jobId })).state.status, 'running');
  const untrusted = { sender: f.sender, senderFrame: { url: 'https://preview.invalid/' } };
  await assert.rejects(api(untrusted, 'resource-acquire', { key: 'external', owner: 'renderer' }), /Hauptfenster/);
  await assert.rejects(api(untrusted, 'workspace-acquire', { projects, owner: 'renderer' }), /Hauptfenster/);
  await f.registry.close();
});
