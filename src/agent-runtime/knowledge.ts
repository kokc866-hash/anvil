import { debugSkill } from '../lib/skill-debug.ts';

export type BackgroundKnowledge = {
 enabled:boolean;
 skillsEnabled:boolean;
 skillBodies:boolean;
 workspace?:string;
 personEnabled?:boolean;
 projectEnabled?:boolean;
 pluginSkills?:boolean;
 appliedEvents?:string[];
 forgotten?:string[];
 forgottenFacts?:string[];
 fileVersions?:Record<string,string|null>;
 memories:{id:string;text:string;scope:'user'|'project';kind?:string;ws?:string;version?:string;conf?:number;hits?:number;at?:number}[];
 skills:{id:string;name:string;description:string;when?:string;body?:string;baseDirectory?:string;resources?:string[];scope?:'user'|'project';ws?:string;file?:string;frontmatter?:string;kind?:'guide'|'plugin';version?:string;uses?:number;score?:number;wins?:number;fails?:number;at?:number}[];
};

/** A permission-filtered immutable request snapshot, never a live renderer store. */
export function readBackgroundKnowledge(snapshot:BackgroundKnowledge|undefined,action:string,args:Record<string,unknown>={}) {
 if(!snapshot?.enabled)return action==='state'?{on:false,inject:false}:{error:'Gedächtnis-Zugriff aus'};
 const memories=snapshot.memories||[],skills=snapshot.skills||[];
 const summary=()=>skills.map(({id,name,description})=>({id,name,when:description}));
 if(action==='list'||action==='state')return {person:memories.filter(x=>x.scope==='user'),project:memories.filter(x=>x.scope==='project'),skills:snapshot.skillsEnabled?summary():[]};
 if(['skills','read','debug'].includes(action)&&!snapshot.skillsEnabled)return {error:'Skills aus'};
 if(action==='skills')return summary();
 if(['read','debug'].includes(action)&&!snapshot.skillBodies)return {error:'Skill-Anweisungen aus'};
 const key=String(args.name||'').trim(),skill=skills.find(x=>x.id===key||x.name===key);
 if(action==='read'){
  if(!skill)return {error:'Skill fehlt im freigegebenen Projektkontext.'};
  return {...skill,when:skill.description,debug:debugSkill({name:skill.name,when:skill.description,body:skill.body||''})};
 }
 if(action==='debug'){
  if(key&&!skill)return {error:'Skill fehlt im freigegebenen Projektkontext.'};
  const report=(key?[skill!]:skills).map(s=>({name:s.name,...debugSkill({name:s.name,when:s.description,body:s.body||''})}));
  const broken=report.filter(s=>!s.ok);
  return {skills:report,broken,issues:broken.flatMap(s=>s.issues.map(issue=>`${s.name}: ${issue}`))};
 }
 return {error:'Dauerhafte Gedächtnisaktionen benötigen den Hintergrunddienst.'};
}
