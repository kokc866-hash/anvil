import {useLearn,workspaceId,type LearnSkill,type LearnFact} from './learn';
import {useIde} from '../store/ide';
import {invalidateMemory} from './memory-scope';
import {mergeKnowledgeEvent,knowledgeVersion} from '../../electron/agent-knowledge-state.mjs';
import {skillInstructionVersion} from '../../electron/skill-feedback.mjs';
import {redactSecrets as scrubSecrets} from './vault';

export type BackgroundKnowledgeEvent={id:string;jobId:string;project:string;workspace:string;collection:'facts'|'skills';recordId:string;beforeVersion:string|null;before:LearnFact|LearnSkill|null;after:LearnFact|LearnSkill|null;action:string;at:number;sourceInstructionVersion?:string};

/** Usage may update metadata, never replace original instructions with a redacted snapshot. */
function skillMetadataEvent(event:BackgroundKnowledgeEvent,current:LearnSkill|undefined):BackgroundKnowledgeEvent|null {
 const before=event.before as LearnSkill|null,after=event.after as LearnSkill|null;
 if(!current||!before||!after||current.id!==before.id||current.id!==after.id)return null;
 const originalVersion=skillInstructionVersion(current)!;
 // Legacy snapshots without this anchor are safe only at an exact source version.
 if(event.sourceInstructionVersion?event.sourceInstructionVersion!==originalVersion:knowledgeVersion(current)!==event.beforeVersion)return null;
 for(const key of ['id','name','when','body','kind','scope','ws','file','frontmatter'] as const){
   const raw=current[key],snapshot=before[key];
   if(raw!==snapshot&&!(typeof raw==='string'&&typeof snapshot==='string'&&scrubSecrets(raw).text===snapshot))return null;
 }
 const feedbackSignature=(skill:LearnSkill)=>JSON.stringify((skill.feedback||[]).map(({version:_version,...entry})=>entry));
 if((current.uses||0)!==(before.uses||0)||feedbackSignature(current)!==feedbackSignature(before))return null;
 const expectedUses=(before.uses||0)+(event.action==='run'?1:0);
 if(after.uses!==expectedUses)return null;
 const old=current.feedback||[],fresh=(after.feedback||[]).filter(entry=>!old.some(value=>value.id===entry.id));
 if(fresh.length>(event.action==='run'?0:1))return null;
 const publicVersion=skillInstructionVersion(before)!;
 if(fresh.some(entry=>!['ok','fail','reject','undo'].includes(entry.kind)||entry.source!=='agent'||!entry.jobId||![originalVersion,publicVersion].includes(entry.version)))return null;
 const feedback=[...old,...fresh.map(entry=>({...entry,version:originalVersion}))].slice(-20);
 return {...event,before:current,beforeVersion:knowledgeVersion(current),after:{...current,uses:expectedUses,...(feedback.length?{feedback}:{}),at:after.at}};
}
/** Consume native acknowledged mutations once, without overwriting a user's newer edits. */
export function applyBackgroundKnowledge(events:BackgroundKnowledgeEvent[]=[]){
 const current=useLearn.getState();const ids=new Set(current.backgroundKnowledgeEvents||[]),conflicts:string[]=[];
 let next={facts:current.facts,skills:current.skills,forgotten:current.forgotten,forgottenFacts:current.forgottenFacts};
 for(const event of events){
   if(ids.has(event.id))continue;
   const record=event.after||event.before;
   if(!record||record.scope==='project'&&event.workspace!==workspaceId())continue;
   const metadata=event.collection==='skills'&&['run','outcome'].includes(event.action);
   const normalized=metadata?skillMetadataEvent(event,next.skills.find(skill=>skill.id===event.recordId)):event;
   const merged=normalized?mergeKnowledgeEvent(next,normalized):{state:next,conflict:true};
   ids.add(event.id);
   if(merged.conflict){conflicts.push(record.id);continue;}
   next=merged.state;
 }
 if(ids.size===(current.backgroundKnowledgeEvents||[]).length)return {applied:0,conflicts};
 const applied=ids.size-(current.backgroundKnowledgeEvents||[]).length;
 useLearn.setState({...next,backgroundKnowledgeEvents:[...ids]});invalidateMemory();
 if(conflicts.length)useIde.getState().setNotice(useIde.getState().locale==='en'?'A background memory change conflicts with a newer edit; your current version was kept.':'Eine Gedächtnisänderung aus dem Hintergrund kollidiert mit einer neueren Bearbeitung; deine aktuelle Fassung bleibt erhalten.');
 return {applied,conflicts};
}
