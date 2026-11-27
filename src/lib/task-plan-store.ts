import {create} from 'zustand';
import {persist} from 'zustand/middleware';
import {idePersistStorage} from './persist-storage';
import {newTaskPlan,reviseTaskPlan,completeTaskPlan,freezePlanExecution,planExecutionMarker,planExecutionPrompt,validTaskPlan,validPlanExecution,type TaskPlan,type PlanExecution} from './task-plan';
type State={plans:TaskPlan[];executions:PlanExecution[]};
function mergeRecords<T extends {id:string;createdAt:number}>(restored:T[],current:T[],limit:number):T[]{return [...new Map([...restored,...current].map(item=>[item.id,item])).values()].sort((a,b)=>a.createdAt-b.createdAt).slice(-limit);}
export const useTaskPlans=create<State>()(persist(()=>({plans:[] as TaskPlan[],executions:[] as PlanExecution[]}),{
  name:'anvil-task-plans',version:1,storage:idePersistStorage(),
  partialize:s=>({plans:s.plans.slice(-16),executions:s.executions.slice(-24)}),
  merge:(raw,current)=>{const p=raw as Partial<State>|undefined;const restored=(Array.isArray(p?.plans)?p.plans:[]).filter(validTaskPlan).slice(-16).map(plan=>plan.status==='generating'?{...plan,status:'interrupted' as const}:plan);return {...current,plans:mergeRecords(restored,current.plans,16),executions:mergeRecords((Array.isArray(p?.executions)?p.executions:[]).filter(validPlanExecution),current.executions,24)};},
}));
export function beginPlanning(project:string,prompt:string):TaskPlan {
  const plan=newTaskPlan(project,prompt);useTaskPlans.setState(s=>({plans:[...s.plans,plan].slice(-16)}));return plan;
}
export function finishPlanning(id:string,generation:string,body:string):void {
  useTaskPlans.setState(s=>({plans:s.plans.map(plan=>plan.id===id?completeTaskPlan(plan,generation,body):plan)}));
}
export function interruptPlanning(id:string,generation:string):void {
  useTaskPlans.setState(s=>({plans:s.plans.map(plan=>plan.id===id&&plan.generation===generation&&plan.status==='generating'?{...plan,status:'interrupted'}:plan)}));
}
export function editTaskPlan(id:string,body:string,project:string):void {
  const plan=useTaskPlans.getState().plans.find(p=>p.id===id&&p.project===project);
  if(!plan)throw Error('Plan gehört nicht zum geöffneten Projekt.');
  const next=reviseTaskPlan(plan,body);useTaskPlans.setState(s=>({plans:s.plans.map(p=>p.id===id?next:p)}));
}
export function preparePlanExecution(id:string,version:number,project:string):string {
  const plan=useTaskPlans.getState().plans.find(p=>p.id===id);
  if(!plan)throw Error('Plan nicht mehr vorhanden.');
  const execution=freezePlanExecution(plan,version,project);
  useTaskPlans.setState(s=>({executions:[...s.executions,execution].slice(-24)}));return planExecutionMarker(execution);
}
export function expandPlanExecution(text:string,project:string):string {
  const match=/^\[\[anvil-plan:([a-f0-9-]{36})\]\]$/.exec(text.trim());
  if(!match)return text;
  const execution=useTaskPlans.getState().executions.find(p=>p.id===match[1]&&p.project===project);
  if(!execution)throw Error('Die gewählte Planversion fehlt oder gehört zu einem anderen Projekt.');
  return planExecutionPrompt(execution);
}
