import {useIde} from '../store/ide';
import {workspaceRules} from './rules';
import {packRefContext,isRefPath,isRefImage,isSecretPath} from './ref';
import {scrubSecrets,lanePrompt,useBrain,brainPlanText} from './brain';
import {learnPrompt,hydrateLearnFromFiles,agentLearn,useLearn,workspaceId,visibleSkills,foregroundKnowledgePermissions} from './learn';
import {builtinSkill,skillToolHints} from './skill-library';
import {skillInstructionVersion} from '../../electron/skill-feedback.mjs';
import {knowledgeVersion,knowledgeFileVersion} from '../../electron/agent-knowledge-state.mjs';
import type { BackgroundKnowledge } from '../agent-runtime/knowledge';
import {internPrompt} from './intern';
import {pinContext} from './fix-agent';
import {attachmentHints} from './attachment-hints';
import {selectFileKeys} from './workspace-index';
import {normalizePlanWho,initialAgentPlan,requestPlanContext,planFromAsk,planHelperNow,planAgentMayReplace} from './plan';
import {packAgentHistory} from './agent-context';
import {taskHandoff} from './task-handoff';
import {connectionCapabilities,historyForConnection} from './connection-capabilities';
import {modelSeesImages} from './ref';
import {normalizeBaseUrl} from './connection';
import {providerOf} from './providers';
import {mcpSnapshot,mcpConfigured} from './mcp';
import {surfacePrompt} from './surface';
import {mcpDiscoveryPrelude} from './capability-search';
import {beginJournal} from './session';

/** Freeze renderer-owned context before handing the task to its independent owner. */
export async function prepareBackgroundContext(prompt:string,images:string[]){
 const st=useIde.getState(),epoch=st.workspaceEpoch;
 const connection={provider:st.llmProvider,authMode:st.llmAuthMode,baseUrl:st.llmBaseUrl,model:st.llmModel};
 const vision=connectionCapabilities(connection).images!=='unsupported'&&(images.length>0||modelSeesImages(st.llmProvider,st.llmModel,normalizeBaseUrl(st.llmBaseUrl||providerOf(st.llmProvider).baseUrl)));
 const extra=[...new Set([...(st.attached||[]),st.activePath,...(useBrain.getState().jobs.attach?attachmentHints(prompt,selectFileKeys(st)):[])].filter((p):p is string=>!!p))];
 const prefer=[...new Set([...extra,...st.openPaths,...st.recentPaths.slice(0,8)])];
 hydrateLearnFromFiles(st.files);
 const prefs=useLearn.getState().prefs;
 const knowledge:BackgroundKnowledge={...foregroundKnowledgePermissions(),workspace:workspaceId(),appliedEvents:useLearn.getState().backgroundKnowledgeEvents,forgotten:useLearn.getState().forgotten,forgottenFacts:useLearn.getState().forgottenFacts,fileVersions:Object.fromEntries(Object.entries(st.files).filter(([path])=>/^\.anvil\/skills\/|^plugins\/skills\//.test(path)).map(([path,content])=>[path,knowledgeFileVersion(content)])),memories:[],skills:[]};
 if(knowledge.enabled){
   const state=await agentLearn('list',{}) as {person?:{id:string;text:string;kind?:string}[];project?:{id:string;text:string;kind?:string}[];skills?:{name:string;when:string}[]};
   knowledge.memories=[...(state.person||[]).map(f=>({...f,scope:'user' as const})),...(state.project||[]).map(f=>({...f,scope:'project' as const}))].map(f=>({...f,version:knowledgeVersion(f)!,text:scrubSecrets(f.text).text}));
   const skillEntries=prefs.skills?visibleSkills():[];
   knowledge.skills=await Promise.all(skillEntries.map(async raw=>{
     const detail=knowledge.skillBodies?await agentLearn('read',{name:raw.id}) as {id?:string;body?:string;baseDirectory?:string;resources?:string[]}:{};
     // The private source hash binds metadata to the original instructions despite redaction.
     return {...raw,id:detail.id||raw.id,name:raw.name,version:knowledgeVersion(raw)!,sourceInstructionVersion:skillInstructionVersion(raw)!,description:scrubSecrets(raw.when).text,when:scrubSecrets(raw.when).text,body:scrubSecrets(raw.body||detail.body||'').text,baseDirectory:detail.baseDirectory,resources:detail.resources?.filter(p=>!isSecretPath(p)),resourceContents:knowledge.skillBodies?builtinSkill(raw.id)?.resources:undefined};
   }));
 }
 const refs=packRefContext(st.files,prompt,extra.filter(isRefPath).concat(st.openPaths.filter(isRefPath)),{vision});
 const context=extra.filter(p=>st.files[p]&&!isSecretPath(p)&&!isRefPath(p)&&!isRefImage(st.files[p])).slice(0,8).map(p=>st.files[p].length>8000?`[${p}] ${st.files[p].split('\n').length} lines; use read_file.`:`[${p}]\n\`\`\`\n${scrubSecrets(st.files[p]).text}\n\`\`\``).join('\n\n');
 const selected=st.pendingAsk?`Selection in ${st.pendingAsk.path}:\n${st.pendingAsk.text.slice(0,4000)}`:'';
 const rules=workspaceRules(st.files,st.agentRules,extra);
 const prefix=scrubSecrets([rules?`Project rules:\n${rules}`:'',lanePrompt(),refs.text,pinContext(prompt),taskHandoff(st.chat),selected,context?`Attached files:\n${context}`:''].filter(Boolean).join('\n\n')).text;
 const work=scrubSecrets(prompt).text;
 const who=normalizePlanWho(st.planWho);
 const planContext=requestPlanContext(work,st.chat);
 let plan=planContext.locked&&planContext.plan?.length?planContext.plan.map(step=>({...step})):initialAgentPlan(planContext.text,planContext.plan,who,st.locale);
 const locked=who==='anvil'||planContext.locked||planFromAsk(planContext.text);
 if(!(planContext.continued&&planContext.plan?.length)&&planHelperNow(who,!!plan.length,locked)){
   const steps=await brainPlanText(planContext.text).catch(()=>[]);
   if(steps.length>=3)plan=steps.map(text=>({text,status:'todo' as const}));
   else plan=initialAgentPlan(planContext.text,planContext.plan,'auto',st.locale);
 }
 if(useIde.getState().workspaceEpoch!==epoch)throw Error(st.locale==='en'?'Project changed while preparing the request.':'Projekt während der Vorbereitung gewechselt.');
 const now=useIde.getState();
 if(now.files!==st.files||now.pendingAsk!==st.pendingAsk||now.agentRules!==st.agentRules||now.llmProvider!==st.llmProvider||now.llmModel!==st.llmModel||now.llmBaseUrl!==st.llmBaseUrl||now.llmAuthMode!==st.llmAuthMode)
   throw Error(st.locale==='en'?'Project or connection changed during preparation. Your input was kept; send it again.':'Projekt oder Verbindung während der Vorbereitung geändert. Eingabe bleibt erhalten; bitte erneut senden.');
 const services=st.mcpServers.filter(server=>mcpConfigured(server)&&(st.surfaceMode==='bridge'||!st.activeSurfaceId||st.activeSurfaceId==='anvil'||server.id===st.activeSurfaceId));
 const catalog=mcpSnapshot(services),mcpHint=mcpDiscoveryPrelude(catalog.tools,work);
 const catalogText=surfacePrompt({id:st.activeSurfaceId||'anvil',mode:st.surfaceMode==='bridge'?'bridge':'exclusive',label:services.find(server=>server.id===st.activeSurfaceId)?.name||'Anvil',tools:catalog.tools,resources:[],context:{},ready:!st.activeSurfaceId||st.activeSurfaceId==='anvil'||catalog.ready.has(st.activeSurfaceId),servers:services.map(server=>({id:server.id,name:server.name,ready:catalog.ready.has(server.id)}))},work);
 const memory=[learnPrompt(planContext.text),internPrompt(),catalogText].filter(Boolean).join('\n\n');
 const selectedSkills=knowledge.skillsEnabled&&knowledge.skillBodies?useLearn.getState().skillSelection:[];
 const toolHints=[...new Set([...(mcpHint.names.length?['mcp_list','mcp_call']:[]),...(selectedSkills.length?['skill_read']:[]),...skillToolHints(selectedSkills)])];
 return {vision,prefer,plan,humanPrompt:scrubSecrets(planContext.humanPrompt??planContext.text).text,humanCorrections:(planContext.humanCorrections||[]).map(text=>scrubSecrets(text).text),planLocked:!planAgentMayReplace(who,locked),compact:st.llmCompact,journal:beginJournal(planContext.text,st.sessionJournal),knowledge,
   memory,toolHints,skillSelection:useLearn.getState().skillSelection,
   messages:packAgentHistory(historyForConnection(st.chat,connection),{content:planContext.continued?`${planContext.text}\n\nAktuelle Folgeanweisung: ${work}`:work,images:vision?[...images,...refs.images].slice(0,4):images.slice(0,4)},prefix,16)};
}
