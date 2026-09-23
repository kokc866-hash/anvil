import {mkdirSync,readFileSync,writeFileSync,renameSync,openSync,closeSync,fsyncSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {knowledgeVersion,knowledgeFileVersion,knowledgePermissions,knowledgeFactKey,knowledgeSkillKey,normalizeKnowledgeText,mergeKnowledgeEvent} from './agent-knowledge-state.mjs';
import {debugKnowledgeSkill as debug,serializeKnowledgeSkill} from './knowledge-skill.mjs';
export {knowledgePermissions};
const clone = value => JSON.parse(JSON.stringify(value));
const projectish = text => /\b(test|pytest|src\/|package\.json|anvil\.run|cargo|go\.mod|pom\.xml|jest|vitest)\b/i.test(text);
const identity = value => createHash('sha256').update(value).digest('hex').slice(0,24);
/** Disk-first outbox: committed operations survive both renderer and application restart. */
export class AgentKnowledge {
  constructor({storagePath}) {
    this.storagePath=storagePath;this.document={version:1,operations:{},events:[]};this.active=[];
    try {const parsed=JSON.parse(readFileSync(storagePath,'utf8'));if(parsed.version!==1||!parsed.operations||!Array.isArray(parsed.events))throw Error('Ungültiges Gedächtnisjournal');this.document=parsed;}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  events(){return clone(this.document.events);}
  permissions(){return knowledgePermissions(this.snapshot);}
  refresh(){
    let latest;try{latest=JSON.parse(readFileSync(this.storagePath,'utf8'));}catch(error){if(error.code==='ENOENT')return;throw error;}
    if(latest.version!==1||!latest.operations||!Array.isArray(latest.events))throw Error('Ungültiges Gedächtnisjournal');
    const known=new Set(this.document.events.map(e=>e.id));
    if(this.state)for(const event of latest.events)if(!known.has(event.id)&&(event.workspace===this.workspace||(event.after||event.before)?.scope==='user'))this.state=mergeKnowledgeEvent(this.state,event).state;
    this.document=latest;
  }
  begin(request,id) {
    this.refresh();
    this.jobId=id;this.project=request.project;this.snapshot=clone(request.knowledge||{enabled:false});
    this.workspace=this.snapshot.workspace||'';
    this.fileVersions=clone(this.snapshot.fileVersions||{});
    this.state={facts:clone(this.snapshot.memories||[]).filter(f=>f.scope!=='project'||f.ws===this.workspace),skills:clone(this.snapshot.skills||[]).filter(s=>s.scope!=='project'||s.ws===this.workspace).map(s=>({...s,when:s.when||s.description||s.name})),forgotten:this.snapshot.forgotten||[],forgottenFacts:this.snapshot.forgottenFacts||[]};
    const applied=new Set(this.snapshot.appliedEvents||[]);
    for(const event of this.document.events) {
      if(applied.has(event.id)||event.workspace!==this.workspace&&(event.after||event.before)?.scope!=='user')continue;
      this.state=mergeKnowledgeEvent(this.state,event).state;
    }
    this.active=[];
    // Rehydrate only this job's active skill uses; another job cannot rate them accidentally.
    for(const operation of Object.values(this.document.operations).filter(x=>x.jobId===id||request.knowledgeResumeFrom&&x.jobId===request.knowledgeResumeFrom))if(operation.active)this.active=operation.active;
  }
  async execute(op,{signal,operationId,files={}}={}) {
    if(signal?.aborted)throw signal.reason||Error('Abgebrochen');
    if(!this.jobId||!operationId)throw Error('Gedächtnisaktion ohne dauerhafte Auftragskennung');
    this.refresh();
    const digest=identity(JSON.stringify([op.action,op.args||{}]));
    const previous=this.document.operations[operationId];
    const p=this.snapshot,action=String(op.action||''),args=op.args||{};
    if(!p.enabled)return {error:'Gedächtnis-Zugriff aus'};
    const skillAction=['skills','write','read','run','debug','patch','outcome'].includes(action);
    if(skillAction&&!p.skillsEnabled)return {error:'Skills aus'};
    if(['read','run','debug'].includes(action)&&!p.skillBodies)return {error:'Skill-Anweisungen aus'};
    if(previous){
      if(previous.digest!==digest||previous.jobId!==this.jobId)throw Error('Gedächtnisaktionskennung wurde mit anderem Inhalt wiederverwendet');
      if((previous.result.knowledgeEvents||[]).some(event=>event.collection==='facts'&&((event.after||event.before).scope==='project'?p.projectEnabled===false:p.personEnabled===false)))return {error:'Fakten-Kategorie aus'};
      return clone(previous.result);
    }
    const permittedFact=f=>f.scope==='project'?p.projectEnabled!==false:p.personEnabled!==false;
    const facts=this.state.facts.filter(permittedFact),skills=this.state.skills;
    const find=key=>skills.find(s=>s.id===key)||skills.find(s=>s.name===key&&s.scope==='project')||skills.find(s=>s.name===key);
    const key=String(args.name||'').trim(),skill=find(key);
    const summary=()=>skills.filter(s=>(s.score??.5)>=.22).map(s=>({name:s.name,when:s.when,score:s.score,uses:s.uses,scope:s.scope}));
    if(action==='list'||action==='state')return {person:facts.filter(f=>f.scope!=='project'),project:facts.filter(f=>f.scope==='project'),skills:p.skillsEnabled?summary():[],workspace:this.workspace};
    if(action==='skills')return summary();
    if(action==='read')return skill?{...skill,debug:debug(skill)}:{error:'skill missing'};
    if(action==='debug'){const report=(key?(skill?[skill]:[]):skills).map(s=>({name:s.name,...debug(s),fails:s.fails,score:s.score}));return {skills:report,broken:report.filter(s=>!s.ok),issues:report.flatMap(s=>s.issues.map(i=>`${s.name}: ${i}`))};}
    let changes=[],result,active=[...this.active];
    const change=(collection,before,after)=>changes.push({id:`knowledge:${identity(operationId)}:${changes.length}`,jobId:this.jobId,project:this.project,workspace:this.workspace,collection,recordId:(after||before).id,before:before||null,beforeVersion:before?before.version||knowledgeVersion(before):null,after:after||null,...(collection==='skills'&&after&&['write','patch'].includes(action)?{allowForgotten:this.state.forgotten.filter(x=>[after.id,after.name,knowledgeSkillKey(after)].includes(x))}:{}),action,at:Date.now()});
    if(action==='add'){
      const kind=['user','project','lesson'].includes(String(args.kind))?String(args.kind):'lesson',text=String(args.text||'').trim().slice(0,220),scope=kind==='project'||projectish(text)?'project':'user',ws=scope==='project'?this.workspace:undefined;
      if(scope==='project'?p.projectEnabled===false:p.personEnabled===false)return {error:'Fakten-Kategorie aus'};
      if(!text)return {error:'Fakt ist leer'};
      if(this.state.forgottenFacts.includes(knowledgeFactKey({text,ws})))return {error:'Dieser Fakt wurde ausdrücklich vergessen'};
      const current=facts.find(f=>f.kind===kind&&normalizeKnowledgeText(f.text)===normalizeKnowledgeText(text)&&(f.ws||'')===(ws||''));
      const fact=current?{...current,hits:(current.hits||0)+1,conf:Math.min(1,(current.conf||0)+.08),at:Date.now()}:{id:`bg-${identity(operationId)}`,kind,text,scope,ws,conf:.85,hits:1,at:Date.now()};
      delete fact.version;change('facts',current,fact);result={ok:true,fact};
    }else if(action==='forget'){
      const key=String(args.id??args.text??'').trim(),current=facts.find(f=>f.id===key||normalizeKnowledgeText(f.text)===normalizeKnowledgeText(key));
      if(!current)return {error:'Fakt fehlt'};
      change('facts',current,null);result={ok:true,id:current.id};
    }else if(action==='write'||action==='patch'){
      if(action==='patch'&&!skill)return {error:'skill fehlt'};
      const name=action==='patch'?skill.name:String(args.name||'').trim()||'skill',scope=action==='patch'?skill.scope:args.scope==='user'?'user':'project',ws=scope==='project'?this.workspace:undefined;
      const current=action==='patch'?skill:skills.find(s=>s.name===name&&s.scope===scope&&s.ws===ws);
      const next={...current,id:current?.id||`${name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'skill'}-${identity(operationId).slice(0,8)}`,name,when:String(args.when??current?.when??name).trim()||name,body:String(args.body??current?.body??'').trim(),kind:action==='patch'?current.kind:args.kind==='plugin'?'plugin':'guide',scope,ws,uses:current?.uses||0,score:current?.score??.6,wins:current?.wins||0,fails:current?.fails||0,at:Date.now()};
      if(next.body.length>100000||next.when.length>4000||next.name.length>200)return {error:'Skill ist zu groß'};
      delete next.version;delete next.description;change('skills',current,next);const report=debug(next);result={...report,skill:action==='patch'?next.name:{name:next.name,kind:next.kind,scope:next.scope,path:next.file||`.anvil/skills/${next.id}.md`}};
    }else if(action==='run'){
      if(!skill)return {error:'no skill'};
      const next={...skill,uses:(skill.uses||0)+1,at:Date.now()};delete next.version;change('skills',skill,next);active=[next.id];result={skill:next.name,body:next.body,baseDirectory:next.baseDirectory,resources:next.resources,score:next.score,issues:debug(next).issues,do:'Follow these instructions within the current user request and tool permissions. Resolve relative resources from baseDirectory. Imported scripts are files, not permission to execute. Then skill_outcome ok or fail.'};
    }else if(action==='outcome'){
      const kind=String(args.kind||'ok');if(!['ok','fail','reject','undo'].includes(kind))return {error:'Unbekanntes Skill-Ergebnis'};
      for(const id of active){const current=find(id);if(!current)continue;const fails=(current.fails||0)+(kind==='ok'?0:1);let body=(current.body||'').replace(/\n⚠[^\n]*/g,'');if(kind!=='ok'&&fails>=2)body+='\n⚠ Letzte Nutzung schlug fehl oder wurde verworfen — Variante prüfen, nicht blind wiederholen.';const next={...current,body,score:Math.max(.05,Math.min(1,(current.score??.55)+(kind==='ok'?.12:-.14))),wins:(current.wins||0)+(kind==='ok'?1:0),fails,at:Date.now()};delete next.version;change('skills',current,next);}
      if(kind==='ok')active=[];result={ok:true};
    }else return {error:`unbekannt ${action}`};
    if(signal?.aborted)throw signal.reason||Error('Abgebrochen');
    const workspaceWrites=[];
    if(['write','patch'].includes(action))for(const event of changes){
      const skill=event.after,path=skill.file&&/^\.anvil\/skills\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.md$/i.test(skill.file)?skill.file:`.anvil/skills/${skill.id}.md`;
      if(!/^[a-z0-9-]+$/i.test(skill.id))return {error:'Ungültige Skill-Dateikennung'};
      if(Object.hasOwn(files,path)&&!event.before)return {error:`Skill-Datei existiert bereits: ${path}`};
      if(this.fileVersions[path]&&this.fileVersions[path]!==knowledgeFileVersion(files[path]??''))return {error:`Skill-Datei wurde zwischenzeitlich geändert: ${path}. Zuerst neu lesen.`};
      workspaceWrites.push({path,before:files[path]??null,content:serializeKnowledgeSkill(skill)});
      if(skill.kind==='plugin'&&p.pluginSkills!==false){
        const pluginPath=`plugins/skills/${skill.id}.js`;
        if(Object.hasOwn(files,pluginPath)&&!event.before)return {error:`Plugin-Datei existiert bereits: ${pluginPath}`};
        if(this.fileVersions[pluginPath]&&this.fileVersions[pluginPath]!==knowledgeFileVersion(files[pluginPath]??''))return {error:`Plugin-Datei wurde zwischenzeitlich geändert: ${pluginPath}`};
        workspaceWrites.push({path:pluginPath,before:files[pluginPath]??null,content:`// @desc ${skill.when.replace(/\n/g,' ')}\nfunction activate(anvil) {\n  anvil.command({\n    id: ${JSON.stringify(`skill.${skill.id}`)},\n    title: ${JSON.stringify(skill.name)},\n    run() {\n      anvil.agent(${JSON.stringify(`Skill ${skill.name}:\n${skill.body}`)});\n    },\n  });\n}\n`});
      }
    }
    result={...result,knowledgeEvents:changes,...(workspaceWrites.length?{workspaceWrites}: {})};
    const document={...this.document,operations:{...this.document.operations,[operationId]:{digest,jobId:this.jobId,result,active}},events:[...this.document.events,...changes]};
    const serialized=JSON.stringify(document);
    if(document.events.length>10000||Object.keys(document.operations).length>10000||Buffer.byteLength(serialized)>8*1024*1024)throw Error('Gedächtnisjournal ist voll. Vor weiteren Änderungen gespeicherte Hintergrundaufträge prüfen. Bestehende Änderungen bleiben erhalten.');
    mkdirSync(dirname(this.storagePath),{recursive:true});const temp=`${this.storagePath}.tmp`;writeFileSync(temp,serialized);const fd=openSync(temp,'r+');try{fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,this.storagePath);
    this.document=document;this.active=active;
    for(const write of workspaceWrites)this.fileVersions[write.path]=knowledgeFileVersion(write.content);
    for(const event of changes){const field=event.collection;this.state[field]=event.after?[event.after,...this.state[field].filter(x=>x.id!==event.recordId)]:this.state[field].filter(x=>x.id!==event.recordId);if(!event.after&&field==='facts')this.state.forgottenFacts=[...new Set([...this.state.forgottenFacts,knowledgeFactKey(event.before)])];}
    return clone(result);
  }
  close(){}
}
