export type TaskPlanRevision=Readonly<{version:number;body:string;at:number}>;
export type TaskPlan={id:string;project:string;prompt:string;createdAt:number;generation:string;status:'generating'|'draft'|'interrupted';revisions:TaskPlanRevision[]};
export type PlanExecution=Readonly<{id:string;planId:string;project:string;version:number;body:string;prompt:string;createdAt:number}>;
const id=()=>globalThis.crypto.randomUUID();
export function newTaskPlan(project:string,prompt:string):TaskPlan {
  if(!project||!prompt.trim())throw Error('Projekt und Planungsauftrag fehlen.');
  if(prompt.length>32000)throw Error('Der Planungsauftrag darf höchstens 32000 Zeichen enthalten. Dein Entwurf bleibt erhalten.');
  return {id:id(),project,prompt,createdAt:Date.now(),generation:id(),status:'generating',revisions:[]};
}
export function reviseTaskPlan(plan:TaskPlan,body:string):TaskPlan {
  if(typeof body!=='string'||!body.trim()||body.length>50000)throw Error('Der Plan benötigt Text mit höchstens 50000 Zeichen.');
  const last=plan.revisions.at(-1);
  if(last?.body===body)return {...plan,status:'draft'};
  return {...plan,status:'draft',revisions:[...plan.revisions,{version:(last?.version||0)+1,body,at:Date.now()}].slice(-16)};
}
export function completeTaskPlan(plan:TaskPlan,generation:string,body:string):TaskPlan {
  if(plan.generation!==generation||plan.status!=='generating')throw Error('Die Planantwort gehört zu einer überholten Planung.');
  return reviseTaskPlan(plan,body);
}
export function freezePlanExecution(plan:TaskPlan,version:number,project:string):PlanExecution {
  const revision=plan.revisions.find(item=>item.version===version);
  if(project!==plan.project||plan.status==='generating'||!revision)throw Error('Diese Planversion gehört nicht zum geöffneten Projekt oder ist noch nicht fertig.');
  return Object.freeze({id:id(),planId:plan.id,project,version,body:revision.body,prompt:plan.prompt,createdAt:Date.now()});
}
export function planExecutionMarker(execution:PlanExecution):string{return `[[anvil-plan:${execution.id}]]`;}
export function planExecutionPrompt(execution:PlanExecution):string {
  return `Implementiere die folgende ausdrücklich gewählte Planversion ${execution.version}. Behalte den Umfang des ursprünglichen Auftrags bei. Prüfe den aktuellen Projektstand und bestätige nur tatsächlich geprüfte Ergebnisse.\n\nUrsprünglicher Auftrag:\n${execution.prompt}\n\nPlanversion ${execution.version}:\n${execution.body}`;
}
export function validTaskPlan(value:unknown):value is TaskPlan {
  const p=value as TaskPlan;
  return Boolean(p&&typeof p.id==='string'&&typeof p.project==='string'&&p.project&&typeof p.prompt==='string'&&p.prompt.length<=32000&&typeof p.generation==='string'&&Number.isFinite(p.createdAt)&&['generating','draft','interrupted'].includes(p.status)&&Array.isArray(p.revisions)&&p.revisions.length<=16&&p.revisions.every((r,i)=>Number.isSafeInteger(r.version)&&r.version>0&&(!i||r.version>p.revisions[i-1].version)&&typeof r.body==='string'&&r.body.length<=50000&&Number.isFinite(r.at)));
}
export function validPlanExecution(value:unknown):value is PlanExecution {
  const p=value as PlanExecution;
  return Boolean(p&&typeof p.id==='string'&&typeof p.planId==='string'&&typeof p.project==='string'&&p.project&&typeof p.prompt==='string'&&p.prompt.length<=32000&&typeof p.body==='string'&&p.body.trim()&&p.body.length<=50000&&Number.isSafeInteger(p.version)&&p.version>0&&Number.isFinite(p.createdAt));
}
