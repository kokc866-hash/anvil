import {useIde} from '../store/ide';
import {workspaceRules} from './rules';
import {packRefContext,isRefPath,isRefImage,isSecretPath} from './ref';
import {scrubSecrets,lanePrompt,useBrain,brainPlanText} from './brain';
import {learnPrompt,hydrateLearnFromFiles,agentLearn,useLearn,workspaceId} from './learn';
import {knowledgeVersion,knowledgeFileVersion} from '../../electron/agent-knowledge-state.mjs';
import type { BackgroundKnowledge } from '../agent-runtime/knowledge';
import {internPrompt} from './intern';
import {pinContext} from './fix-agent';
import {attachmentHints} from './attachment-hints';
import {selectFileKeys} from './workspace-index';
import {normalizePlanWho,guessPlan,planSeedNow,planFromAsk,planHelperNow,planAgentMayReplace} from './plan';
import {packChatHistory} from './session';
import {taskHandoff} from './task-handoff';
import {connectionCapabilities,historyForConnection} from './connection-capabilities';
import {modelSeesImages} from './ref';

/** Freeze renderer-owned context before handing the task to its independent owner. */
export async function prepareBackgroundContext(prompt:string,images:string[]){
 const st=useIde.getState(),epoch=st.workspaceEpoch;
 const connection={provider:st.llmProvider,authMode:st.llmAuthMode,baseUrl:st.llmBaseUrl,model:st.llmModel};
 const vision=connectionCapabilities(connection).images!=='unsupported'&&(images.length>0||modelSeesImages(st.llmProvider,st.llmModel));
 const extra=[...new Set([...(st.attached||[]),st.activePath,...(useBrain.getState().jobs.attach?attachmentHints(prompt,selectFileKeys(st)):[])].filter((p):p is string=>!!p))];
 const prefer=[...new Set([...extra,...st.openPaths,...st.recentPaths.slice(0,8)])];
 hydrateLearnFromFiles(st.files);
 const prefs=useLearn.getState().prefs;
 const knowledge:BackgroundKnowledge={enabled:useLearn.getState().on&&prefs.inject,skillsEnabled:prefs.skills,skillBodies:prefs.skillBodies,personEnabled:prefs.person,projectEnabled:prefs.project,pluginSkills:prefs.pluginSkills,workspace:workspaceId(),appliedEvents:useLearn.getState().backgroundKnowledgeEvents,forgotten:useLearn.getState().forgotten,forgottenFacts:useLearn.getState().forgottenFacts,fileVersions:Object.fromEntries(Object.entries(st.files).filter(([path])=>/^\.anvil\/skills\/|^plugins\/skills\//.test(path)).map(([path,content])=>[path,knowledgeFileVersion(content)])),memories:[],skills:[]};
 if(knowledge.enabled){
   const state=await agentLearn('list',{}) as {person?:{id:string;text:string;kind?:string}[];project?:{id:string;text:string;kind?:string}[];skills?:{name:string;when:string}[]};
   knowledge.memories=[...(state.person||[]).map(f=>({...f,scope:'user' as const})),...(state.project||[]).map(f=>({...f,scope:'project' as const}))].map(f=>({...f,version:knowledgeVersion(f)!,text:scrubSecrets(f.text).text}));
   const skillEntries=prefs.skills?useLearn.getState().skills.filter(s=>s.scope!=='project'||s.ws===knowledge.workspace):[];
   knowledge.skills=await Promise.all(skillEntries.map(async raw=>{
     const detail=knowledge.skillBodies?await agentLearn('read',{name:raw.id}) as {id?:string;body?:string;baseDirectory?:string;resources?:string[]}:{};
     // Full bodies are retained privately by the durable host for patch/outcome. Tool reads still enforce skillBodies.
     return {...raw,id:detail.id||raw.id,name:raw.name,version:knowledgeVersion(raw)!,description:scrubSecrets(raw.when).text,when:scrubSecrets(raw.when).text,body:scrubSecrets(raw.body||detail.body||'').text,baseDirectory:detail.baseDirectory,resources:detail.resources?.filter(p=>!isSecretPath(p))};
   }));
 }
 const refs=packRefContext(st.files,prompt,extra.filter(isRefPath).concat(st.openPaths.filter(isRefPath)),{vision});
 const context=extra.filter(p=>st.files[p]&&!isSecretPath(p)&&!isRefPath(p)&&!isRefImage(st.files[p])).slice(0,8).map(p=>st.files[p].length>8000?`[${p}] ${st.files[p].split('\n').length} lines; use read_file.`:`[${p}]\n\`\`\`\n${scrubSecrets(st.files[p]).text}\n\`\`\``).join('\n\n');
 const selected=st.pendingAsk?`Selection in ${st.pendingAsk.path}:\n${st.pendingAsk.text.slice(0,4000)}`:'';
 const rules=workspaceRules(st.files,st.agentRules);
 const prefix=scrubSecrets([rules?`Project rules:\n${rules}`:'',lanePrompt(),refs.text,pinContext(prompt),taskHandoff(st.chat),selected,context?`Attached files:\n${context}`:''].filter(Boolean).join('\n\n')).text;
 const work=scrubSecrets(prompt).text;
 const who=normalizePlanWho(st.planWho);
 let plan=planSeedNow(who)?guessPlan(work,st.locale):[];
 const locked=who==='anvil'||(who==='auto'&&planFromAsk(work));
 if(planHelperNow(who,!!plan.length,locked)){
   const steps=await brainPlanText(work).catch(()=>[]);
   if(steps.length>=3)plan=steps.map(text=>({text,status:'todo' as const}));
 }
 if(useIde.getState().workspaceEpoch!==epoch)throw Error(st.locale==='en'?'Project changed while preparing the request.':'Projekt während der Vorbereitung gewechselt.');
 const now=useIde.getState();
 if(now.files!==st.files||now.pendingAsk!==st.pendingAsk||now.agentRules!==st.agentRules||now.llmProvider!==st.llmProvider||now.llmModel!==st.llmModel||now.llmBaseUrl!==st.llmBaseUrl||now.llmAuthMode!==st.llmAuthMode)
   throw Error(st.locale==='en'?'Project or connection changed during preparation. Your input was kept; send it again.':'Projekt oder Verbindung während der Vorbereitung geändert. Eingabe bleibt erhalten; bitte erneut senden.');
 return {vision,prefer,plan,planLocked:!planAgentMayReplace(who,locked),compact:st.llmCompact,journal:st.sessionJournal,knowledge,
   memory:[learnPrompt(work),internPrompt()].filter(Boolean).join('\n\n'),
   messages:packChatHistory(historyForConnection(st.chat,connection),{content:prefix?`${prefix}\n\nTask:\n${work}`:work,images:vision?[...images,...refs.images].slice(0,4):images.slice(0,4)},16)};
}
