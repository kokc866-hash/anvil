import {useLearn,workspaceId,type LearnSkill,type LearnFact} from './learn';
import {useIde} from '../store/ide';
import {invalidateMemory} from './memory-scope';
import {mergeKnowledgeEvent} from '../../electron/agent-knowledge-state.mjs';

export type BackgroundKnowledgeEvent={id:string;jobId:string;project:string;workspace:string;collection:'facts'|'skills';recordId:string;beforeVersion:string|null;before:LearnFact|LearnSkill|null;after:LearnFact|LearnSkill|null;action:string;at:number};
/** Consume native acknowledged mutations once, without overwriting a user's newer edits. */
export function applyBackgroundKnowledge(events:BackgroundKnowledgeEvent[]=[]){
 let current=useLearn.getState();const ids=new Set(current.backgroundKnowledgeEvents||[]),conflicts:string[]=[];
 let next={facts:current.facts,skills:current.skills,forgotten:current.forgotten,forgottenFacts:current.forgottenFacts};
 for(const event of events){
   if(ids.has(event.id))continue;
   const record=event.after||event.before;
   if(!record||record.scope==='project'&&event.workspace!==workspaceId())continue;
   const merged=mergeKnowledgeEvent(next,event);
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
