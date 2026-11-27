import {useState,useEffect} from 'react';
import {useIde} from '@/store/ide';
import {useTaskPlans,editTaskPlan,preparePlanExecution} from '@/lib/task-plan-store';
export function TaskPlanPane(){
  const project=useIde(s=>s.workspaceCwd||s.memoryWorkspace),plans=useTaskPlans(s=>s.plans);
  const plan=[...plans].reverse().find(p=>p.project===project),[editing,setEditing]=useState(false),[body,setBody]=useState('');
  const [selectedVersion,setSelectedVersion]=useState<number>();
  useEffect(()=>{setEditing(false);setBody('');setSelectedVersion(undefined);},[plan?.id]);
  const revision=plan?.revisions.find(r=>r.version===selectedVersion)||plan?.revisions.at(-1);
  if(!plan)return null;
  const notice=(error:unknown)=>useIde.getState().setNotice(error instanceof Error?error.message:String(error));
  return <details className="mx-3 my-2 min-w-0 rounded-lg border border-border p-3 text-sm" data-testid="task-plan">
    <summary className="cursor-pointer">Plan {revision?`· Version ${revision.version}`:''}{plan.status==='generating'?' · Wird erstellt':plan.status==='interrupted'?' · Unterbrochen':''}</summary>
    {plan.revisions.length>1&&!editing?<label className="my-2 flex items-center gap-2">Version<select className="rounded border border-border bg-bg px-2 py-1" aria-label="Planversion" value={revision?.version} onChange={e=>setSelectedVersion(Number(e.target.value))}>{plan.revisions.map(r=><option key={r.version} value={r.version}>{r.version}</option>)}</select></label>:null}
    {editing?<><textarea aria-label="Plan bearbeiten" className="my-2 min-h-48 w-full resize-y rounded border border-border bg-bg p-2" value={body} onChange={e=>setBody(e.target.value)} maxLength={50000}/><button className="mr-3 underline" onClick={()=>{try{editTaskPlan(plan.id,body,project);setSelectedVersion(undefined);setEditing(false);}catch(e){notice(e);}}}>Plan speichern</button><button onClick={()=>setEditing(false)}>Verwerfen</button></>:<>
      {revision?<p className="my-2 max-h-80 overflow-auto whitespace-pre-wrap break-words">{revision.body}</p>:<p className="my-2 text-muted">Die Planung liest das Projekt und verändert keine Projektdateien.</p>}
      {revision&&<div className="flex flex-wrap gap-3"><button className="underline" onClick={()=>{setBody(revision.body);setEditing(true);}}>Bearbeiten</button><button className="underline" onClick={()=>{try{const st=useIde.getState();if((st.workspaceCwd||st.memoryWorkspace)!==project)throw Error('Projekt wurde gewechselt.');st.pushAgent(preparePlanExecution(plan.id,revision.version,project),false,'agent');}catch(e){notice(e);}}}>Version {revision.version} umsetzen</button></div>}
      <p className="mt-2 text-xs text-muted">Die Umsetzung verwendet genau diese Version. Spätere Änderungen am Plan bleiben getrennt.</p>
    </>}
  </details>;
}
