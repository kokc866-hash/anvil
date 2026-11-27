import { utilityProcess } from 'electron';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AgentJobHost } from './agent-job-host.mjs';
import { AgentJobRegistry } from './agent-job-registry.mjs';
import { guardJobRuntime, sharedAgentResourceGate } from './resource-gate.mjs';
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
import { workflowJournalPath, writeWorkflowJournal, readWorkflowJournal } from './workflow-journal.mjs';
import { assertLlmTarget } from '../scripts/llm-agent.mjs';

export function bindAgentJobIpc({ root, dataHome, isTrusted, editor }) {
  const entry = join(root, 'agent-build', 'worker.mjs');
  const available=()=>existsSync(entry)&&['service-contract.mjs','preview-runtime.mjs','debug-trace.mjs'].every(file=>existsSync(join(root,'agent-build',file)));
  const registry = new AgentJobRegistry({directory:join(dataHome,'agent-jobs'),gate:sharedAgentResourceGate,createHost({jobId,snapshotPath,gate}) {
    const connections=new AgentConnections({mcp:createBackgroundMcpHost()});
    const engines=new AgentEngines({environment:()=>engineEnvironment(toolEnv(),readEngineConfig(join(loadPaths().packages,'toolchains','engine-paths.json')))});
    const knowledge=new AgentKnowledge({storagePath:join(dirname(snapshotPath),'knowledge.json')});
    const runtime=guardJobRuntime(new AgentProjectRuntime({preview:new AgentPreview(),connections,engines,knowledge}),gate,jobId);
    return new AgentJobHost({ runtime, snapshotPath, artifactRoot:join(dataHome,'agent-jobs'), launch() {
    if (!available()) throw new Error('Hintergrundprozess fehlt im Build.');
    const child = utilityProcess.fork(entry, [], { serviceName: 'Anvil Agent', stdio: 'ignore' });
    const bridge = new EventEmitter();
    child.on('message', value => bridge.emit('message', value));
    child.on('exit', code => bridge.emit('exit', code));
    bridge.send = value => child.postMessage(value);
    bridge.kill = () => child.kill();
    return bridge;
    } });
  }});
  const watched=new WeakSet(),foregroundLeases=new Map();
  function foregroundOwner(event, owner) {
    if(typeof owner!=='string'||!owner||owner.length>100||!/^[-a-zA-Z0-9_:./]+$/.test(owner))throw Error('Ungültiger Ressourcenbesitzer.');
    const contents=event.sender,prefix=`foreground:${contents.id}:`;
    if(!watched.has(contents)){
      watched.add(contents);
      const release=()=>{
        for(const [id,lease] of foregroundLeases)if(lease.owner.startsWith(prefix)){sharedAgentResourceGate.release(id,lease.owner);foregroundLeases.delete(id);}
        registry.releaseWorkspacePrefix(prefix);
      };
      contents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame)release();});
      contents.once('destroyed',release);
      contents.on('render-process-gone',release);
    }
    return prefix+owner;
  }
  handleOnce('agent-job', async (event, action, payload) => {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || event.sender !== editor()?.webContents || !isTrusted(event.senderFrame.url)) throw new Error('Hintergrundaufträge nur im Anvil-Hauptfenster verfügbar.');
    if(action==='workflow-write')return writeWorkflowJournal(workflowJournalPath(join(dataHome,'agent-workflows'),payload?.project,payload?.snapshot?.id),payload.snapshot);
    if(action==='workflow-read')return {snapshot:readWorkflowJournal(workflowJournalPath(join(dataHome,'agent-workflows'),payload?.project,payload?.id))};
    if(action==='resource-acquire'){
      const owner=foregroundOwner(event,payload?.owner),lease=sharedAgentResourceGate.acquire(owner,payload?.key);
      foregroundLeases.set(lease.leaseId,lease);
      return {...lease,owner:payload.owner};
    }
    if(action==='resource-release'){
      const owner=foregroundOwner(event,payload?.owner),lease=foregroundLeases.get(payload?.leaseId);
      if(!lease)return {ok:true,released:false};
      if(lease.owner!==owner)throw Error('Ressourcenbindung gehört zu einer anderen Sitzung.');
      foregroundLeases.delete(lease.leaseId);return sharedAgentResourceGate.release(lease.leaseId,owner);
    }
    if(action==='workspace-acquire')return {...registry.acquireWorkspace(payload?.projects,foregroundOwner(event,payload?.owner)),owner:payload.owner};
    if(action==='workspace-release')return registry.releaseWorkspace(payload?.leaseId,foregroundOwner(event,payload?.owner));
    if(action==='jobs')return {available:available(),...registry.jobs()};
    if(action==='select')return {available:available(),...registry.select(payload?.jobId,payload?.expectedJobId)};
    if(action==='close-resources'){
      if(!payload?.jobId||!payload?.id)throw Error('Auftrag und Sitzung eindeutig auswählen.');
      const host=registry.hostFor(payload);if(!host||host.busy())throw Error('Laufenden Auftrag zuerst beenden.');
      await host.cleanRuntime();await host.waitForCleanup();
      return registry.wrap(host,{...host.snapshot(),...(host.runtime?.resourceBusy?.()?{error:'Das Ende der Sitzung ist noch nicht bestätigt.'}:{})});
    }
    if (action === 'status') return { available: available(), ...registry.snapshot(payload?.id, payload?.revision, payload?.draftRevision,payload?.jobId) };
    if (action === 'stop') {const host=registry.hostFor(payload);return registry.wrap(host,host?.stop()||{state:null});}
    if(action==='steer'){const host=registry.hostFor(payload);if(!host)throw Error('Kein aktiver Hintergrundauftrag.');return registry.wrap(host,host.steer(payload?.id,payload?.text,payload?.messageId,payload?.images));}
    if(action==='debug'){const host=registry.hostFor(payload);if(!host)throw Error('Kein aktiver Hintergrundauftrag.');return registry.wrap(host,await host.debug(payload?.id,payload?.action,payload?.args));}
    if (action === 'dismiss') { const host=registry.hostFor(payload);if(!host)throw Error('Hintergrundauftrag fehlt.');const result=host.dismiss(payload?.id);await host.waitForCleanup();return registry.wrap(host,result); }
    if(action==='apply'||action==='restore'){const host=registry.hostFor(payload);if(!host)throw Error('Hintergrundauftrag fehlt.');registry.assertWriteHost(host);return registry.wrap(host,host.changeFiles(payload?.id,action));}
    if(action==='permissions'){
      const host=registry.hostFor(payload);if(!host)return {state:null};
      if(host.busy()&&payload?.knowledge&&host.runtime.knowledge.permissions()!==knowledgePermissions(payload.knowledge))return registry.wrap(host,host.stop('Freigaben für Gedächtnis oder Skills wurden geändert. Der Auftrag wurde gestoppt; gespeicherte Änderungen bleiben erhalten.'));
      const surface=payload?.bound===true?host.runtime.connections.surface:payload?.surface;
      if(host.busy() && !host.runtime.connections.samePermissions(payload?.services||[],surface))return registry.wrap(host,host.stop('Dienste oder Arbeitsfläche wurden verändert. Auftrag gestoppt; externe Aktionen werden nicht wiederholt.'));
      return registry.wrap(host,host.snapshot(payload?.id,payload?.revision,payload?.draftRevision));
    }
    if (action === 'start'||action==='resume') {
      if(payload?.model?.cliKind){if(!CLI_KINDS.includes(payload.model.cliKind))throw new Error('Unbekannte CLI.');}
      else{
        if (!['ollama', 'lmstudio', 'llamacpp', 'vllm', 'localai', 'custom', 'qwen', 'deepseek'].includes(payload?.model?.provider)) throw new Error('Der Hintergrundbetrieb unterstützt lokale APIs, Qwen AI, DeepSeek und CLI-Verbindungen.');
        const url = new URL(payload.model.baseUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Ungültige Modelladresse.');
        if (['qwen','deepseek'].includes(payload.model.provider)) {
          assertLlmTarget(url.toString());
          if (typeof payload.model.apiKey!=='string'||!payload.model.apiKey.trim()) throw new Error('API-Schlüssel fehlt.');
          if (typeof payload.model.model!=='string'||!payload.model.model.trim()) throw new Error('Modell auswählen oder Modell-ID eingeben.');
        }
      }
      payload.maxRounds = Math.min(256, Math.max(1, Number(payload.maxRounds) || 24));
      payload.model.hardStopMin = Math.min(480, Math.max(0, Number(payload.model.hardStopMin) || 0));
      return action==='resume'?registry.resume(payload.resumeId,payload,payload.jobId):registry.start(payload);
    }
    throw new Error('Unbekannter Hintergrundauftrag.');
  });
  return registry;
}
