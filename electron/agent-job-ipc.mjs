import { utilityProcess } from 'electron';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AgentJobHost } from './agent-job-host.mjs';
import { handleOnce } from './ipc.mjs';
import { AgentProjectRuntime } from './agent-project-runtime.mjs';
import { AgentPreview } from './agent-preview.mjs';
import { AgentConnections } from './agent-connections.mjs';
import { createBackgroundMcpHost } from './mcp-ipc.mjs';
import { CLI_KINDS } from './cli-runner.mjs';
import { AgentEngines } from './agent-engines.mjs';
import { engineEnvironment, readEngineConfig } from '../companion/engine-config.mjs';
import { toolEnv } from '../companion/toolchain.mjs';
import { loadPaths } from './paths.mjs';
import { AgentKnowledge, knowledgePermissions } from './agent-knowledge.mjs';

export function bindAgentJobIpc({ root, dataHome, isTrusted, editor }) {
  const entry = join(root, 'agent-build', 'worker.mjs');
  const available=()=>existsSync(entry)&&['service-contract.mjs','preview-runtime.mjs','debug-trace.mjs'].every(file=>existsSync(join(root,'agent-build',file)));
  const connections=new AgentConnections({mcp:createBackgroundMcpHost()});
  const engines=new AgentEngines({environment:()=>engineEnvironment(toolEnv(),readEngineConfig(join(loadPaths().packages,'toolchains','engine-paths.json')))});
  const knowledge=new AgentKnowledge({storagePath:join(dataHome,'agent-jobs','knowledge.json')});
  const host = new AgentJobHost({ runtime: new AgentProjectRuntime({ preview: new AgentPreview(), connections, engines,knowledge }), snapshotPath: join(dataHome, 'agent-jobs', 'latest.json'), launch() {
    if (!available()) throw new Error('Hintergrundprozess fehlt im Build.');
    const child = utilityProcess.fork(entry, [], { serviceName: 'Anvil Agent', stdio: 'ignore' });
    const bridge = new EventEmitter();
    child.on('message', value => bridge.emit('message', value));
    child.on('exit', code => bridge.emit('exit', code));
    bridge.send = value => child.postMessage(value);
    bridge.kill = () => child.kill();
    return bridge;
  } });
  handleOnce('agent-job', async (event, action, payload) => {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || event.sender !== editor()?.webContents || !isTrusted(event.senderFrame.url)) throw new Error('Hintergrundaufträge nur im Anvil-Hauptfenster verfügbar.');
    if (action === 'status') return { available: available(), ...host.snapshot(payload?.id, payload?.revision) };
    if (action === 'stop') return host.stop();
    if(action==='debug')return host.debug(payload?.id,payload?.action,payload?.args);
    if (action === 'dismiss') { const result=host.dismiss(payload?.id);await host.waitForCleanup();return result; }
    if(action==='apply'||action==='restore')return host.changeFiles(payload?.id,action);
    if(action==='permissions'){
      if(host.busy()&&payload?.knowledge&&knowledge.permissions()!==knowledgePermissions(payload.knowledge))return host.stop('Gedächtnisfreigaben wurden verändert. Auftrag gestoppt; gespeicherte Änderungen bleiben erhalten.');
      if(host.busy() && !connections.samePermissions(payload?.services||[],payload?.surface))return host.stop('Dienste oder Arbeitsfläche wurden verändert. Auftrag gestoppt; externe Aktionen werden nicht wiederholt.');
      return host.snapshot(payload?.id,payload?.revision);
    }
    if (action === 'start'||action==='resume') {
      if(payload?.model?.cliKind){if(!CLI_KINDS.includes(payload.model.cliKind))throw new Error('Unbekannte CLI.');}
      else{
        if (!['ollama', 'lmstudio', 'llamacpp', 'vllm', 'localai', 'custom'].includes(payload?.model?.provider)) throw new Error('Der Hintergrund-Test unterstützt lokale API- und CLI-Verbindungen.');
        const url = new URL(payload.model.baseUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Ungültige Modelladresse.');
      }
      payload.maxRounds = Math.min(256, Math.max(1, Number(payload.maxRounds) || 24));
      payload.model.hardStopMin = Math.min(480, Math.max(0, Number(payload.model.hardStopMin) || 0));
      await host.waitForCleanup();
      return action==='resume'?host.resume(payload.resumeId,payload,payload.reviewed===true):host.start(payload);
    }
    throw new Error('Unbekannter Hintergrundauftrag.');
  });
  return host;
}
