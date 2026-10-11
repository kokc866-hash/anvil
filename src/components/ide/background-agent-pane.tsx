import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, X } from 'lucide-react';
import { useIde } from '@/store/ide';
import { applyBackgroundDrafts, backgroundRunning, dismissBackgroundJob, restoreBackgroundFiles, resumeBackgroundJob, reviewBackgroundOperation, stopBackgroundAgent, useBackgroundAgent } from '@/lib/background-agent';
import { AcceptanceSummary } from './acceptance-summary';
import type { WorkflowOperation } from '@/lib/agent-workflow';

function OperationReview({operation,en,disabled}:{operation:WorkflowOperation;en:boolean;disabled:boolean}){
  const [outcome,setOutcome]=useState(''),[note,setNote]=useState(''),[saving,setSaving]=useState(false);
  const s=(de:string,enText:string)=>en?enText:de;
  return <fieldset disabled={disabled||saving} className="mt-2 min-w-0 rounded border border-border p-2">
    <legend className="break-words px-1 font-medium">{operation.target}</legend>
    <label className="block">{s('Was ist passiert?','What happened?')}
      <select aria-label={s(`Ausgang von ${operation.id}`,`Outcome of ${operation.id}`)} className="mt-1 w-full rounded border border-border bg-bg p-1" value={outcome} onChange={e=>setOutcome(e.target.value)}>
        <option value="">{s('Noch unklar','Still unclear')}</option>
        <option value="confirmed">{s('Aktion ausgeführt; Ergebnis geprüft','Action executed; result checked')}</option>
        <option value="not-executed">{s('Aktion nachweislich nicht ausgeführt','Action confirmed not executed')}</option>
      </select>
    </label>
    <label className="mt-2 block">{s('Was hast du im Programm oder Protokoll gesehen?','What did you see in the program or log?')}
      <textarea aria-label={s(`Prüfergebnis für ${operation.id}`,`Review evidence for ${operation.id}`)} placeholder={s('Zum Beispiel: Die erwartete Datei ist gespeichert; im Dienst läuft keine Aktion mehr. Nur eintragen, wenn du es selbst geprüft hast.','For example: The expected file is saved; no action is still running in the service. Only enter what you actually checked.')} className="mt-1 min-h-16 w-full resize-y rounded border border-border bg-bg p-1" rows={2} maxLength={1000} value={note} onChange={e=>setNote(e.target.value)} />
    </label>
    <button className="mt-2 disabled:opacity-50" disabled={disabled||saving||!outcome||note.trim().length<12} onClick={async()=>{
      if(outcome!=='confirmed'&&outcome!=='not-executed')return;
      setSaving(true);try{await reviewBackgroundOperation(operation.id,outcome,note);}finally{setSaving(false);}
    }}>{s('Prüfergebnis speichern','Save review')}</button>
    <details className="mt-2 text-muted"><summary>{s('Technische Kennung','Technical identifier')}</summary><p className="break-all">{operation.id}</p></details>
  </fieldset>;
}

export function BackgroundAgentPane() {
  const { job, error, startFailure } = useBackgroundAgent();
  const en=useIde(s=>s.locale==='en');
  const project=useIde(s=>s.workspaceCwd||s.memoryWorkspace);
  const s=(de:string,enText:string)=>en?enText:de;
  const [inspect, setInspect] = useState(false);
  const [detailsOpen,setDetailsOpen]=useState(false);
  const [reviewed,setReviewed]=useState(false);
  const [answer,setAnswer]=useState('');
  const [sending,setSending]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null);
  const detailsButton=useRef<HTMLButtonElement>(null);
  const dialogTitle=useId();
  useEffect(()=>{setReviewed(false);setInspect(false);setDetailsOpen(false);setAnswer('');setSending(false);},[job?.id]);
  useEffect(()=>{
    const element=dialog.current;
    if(detailsOpen&&!element?.open)element?.showModal();
    else if(!detailsOpen&&element?.open)element.close();
  },[detailsOpen,job?.id]);
  function closeDetails(){setDetailsOpen(false);detailsButton.current?.focus();}
  const failure=startFailure?.project===project&&<section role="alert" className="mx-3 my-2 min-w-0 rounded-lg border border-warn/40 p-3 text-xs">
    <p className="font-medium">{s('Auftrag konnte nicht gestartet werden','Could not start the task')}</p>
    <p className="mt-1 whitespace-pre-wrap break-words text-warn">{startFailure.message}</p>
    <p className="mt-1 text-muted">{s('Prüfe die Meldung und sende deine Eingabe anschließend erneut. Diese Meldung bleibt bis zum erfolgreichen Start oder Ausblenden sichtbar.','Check the message, then send your input again. This message stays visible until the task starts successfully or you dismiss it.')}</p>
    <button className="mt-2" onClick={()=>useBackgroundAgent.setState({startFailure:null})}>{s('Meldung ausblenden','Dismiss message')}</button>
  </section>;
  if (!job || job.dismissed) return <>{failure}{error&&<p role="status" className="p-2 text-xs text-warn">{error}</p>}</>;
  const running = backgroundRunning(job), paths = Object.keys(job.drafts);
  const waiting=job.status==='waiting-user'&&job.ask;
  const unconfirmed=job.workflow?.operations.filter(op=>op.external&&['unclear','started'].includes(op.status))||[];
  const resolutions=job.workflow?.operations.filter(op=>op.resolution)||[];
  const blocked=Boolean(job.persistenceError||job.project!==project);
  const checking=Boolean(unconfirmed.length||job.recoveryBlockedActions?.length||job.operation?.digest&&job.operation.status!=='done'&&!reviewed);
  const problem=Boolean(error||job.error||job.persistenceError||unconfirmed.length||job.acceptance?.state==='failed');
  const stateLabel=job.status==='stopping'?s('Wird beendet','Stopping'):running?s('Läuft','Running'):waiting?s('Antwort nötig','Answer needed'):job.status==='done'?s('Beendet','Ended'):s('Angehalten','Paused');
  const needsReview=!running&&job.status!=='done'&&blocked;
  const acceptanceOpen=job.acceptance&&job.acceptance.state!=='passed'&&job.acceptance.criteria.length>0;
  async function continueTask(){
    if(sending||blocked)return;
    setSending(true);
    try{await resumeBackgroundJob(reviewed);closeDetails();}
    finally{setSending(false);}
  }
  async function reply(choiceId?:string){
    if(!job?.ask||sending||blocked)return;
    setSending(true);
    try{await resumeBackgroundJob(reviewed,{askId:job.ask.id,...(choiceId?{choiceId}:{text:answer.trim()})});}
    finally{setSending(false);}
  }
  return <>{failure}<section aria-label={s('Hintergrundauftrag','Background task')} className="my-1 min-w-0 rounded-md border border-border px-2 py-1 text-xs">
    <div className="flex min-w-0 items-center gap-2">
      <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${problem?'bg-warn':running?'bg-ok':'bg-muted'}`} />
      <p role="status" className="min-w-0 flex-1 truncate">{stateLabel} · {paths.length} {s(paths.length===1?'Datei':'Dateien',paths.length===1?'file':'files')}{!running&&job.status==='done'&&(acceptanceOpen||checking)?` · ${s('Prüfung offen','Checks open')}`:''}</p>
      {running?<button className="shrink-0 rounded px-2 py-1 hover:bg-hover" onClick={()=>void stopBackgroundAgent()}>{s('Stoppen','Stop')}</button>:job.status!=='done'&&<button className="shrink-0 rounded px-2 py-1 hover:bg-hover disabled:opacity-50" title={checking?s('Stand prüfen und fortsetzen. Unbestätigte Aktionen werden nicht wiederholt.','Check current state and resume. Unconfirmed actions will not be repeated.'):undefined} disabled={sending} onClick={()=>needsReview||waiting?setDetailsOpen(true):void continueTask()}>{needsReview?s('Details','Details'):waiting?s('Antworten','Reply'):s('Fortsetzen','Resume')}</button>}
      <button ref={detailsButton} className="shrink-0 rounded p-1 hover:bg-hover" aria-label={s('Auftragsdetails öffnen','Open task details')} aria-haspopup="dialog" aria-expanded={detailsOpen} onClick={()=>setDetailsOpen(true)}><MoreHorizontal className="size-4" /></button>
    </div>
  </section>
  {typeof document!=='undefined'&&createPortal(<dialog ref={dialog} aria-labelledby={dialogTitle} onCancel={()=>setDetailsOpen(false)} onClose={closeDetails} onClick={e=>{if(e.target===e.currentTarget)closeDetails();}} className="fixed inset-0 m-auto max-h-[min(38rem,calc(100dvh-2rem))] w-[min(42rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-0 text-xs text-fg shadow-xl backdrop:bg-black/50 open:flex open:flex-col">
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3"><h2 id={dialogTitle} className="text-sm font-medium">{s('Auftragsdetails','Task details')}</h2><button className="rounded p-1 hover:bg-hover" aria-label={s('Schließen','Close')} onClick={closeDetails}><X className="size-4" /></button></header>
    <div className="min-h-0 overflow-y-auto p-4">
    <p className="font-medium">{stateLabel} · {paths.length} {s(paths.length===1?'Datei':'Dateien',paths.length===1?'file':'files')}</p>
    <p className="mt-1 break-words text-muted">{job.connection}{job.services?.length?` · ${job.services.length} ${s('Dienste','services')}`:''}</p>
    <p className="mt-1 text-muted">{job.writeThrough ? s('Bestätigte Änderungen werden im Projekt gespeichert. Vorherige Inhalte bleiben gesichert.','Acknowledged changes are saved to the project. Previous content remains backed up.') : s('Dateientwürfe werden gesichert und können anschließend im Editor geprüft werden.','Drafts are saved for review in the editor.')} {running && s('Anvil beenden stoppt den Auftrag.','Exiting Anvil stops the task.')}</p>
    {job.operation?.status === 'pending' && <p className="mt-1 break-words text-muted">{job.operation.kind === 'cli'?s('Modellantwort über CLI läuft …','Waiting for the CLI model…'):job.operation.kind==='mcp'?`${s('Dienst','Service')}: ${job.operation.name||s('Katalog laden','Load catalog')}`:`${s('Aktion','Action')}: ${job.operation.path || job.operation.kind}`}</p>}
    {job.pendingRun&&<p className="mt-1">{s('Prüfung läuft','Verification running')}: {job.pendingRun.path}</p>}
    <AcceptanceSummary value={job.acceptance} en={en} />
    {job.lastRun && <details className="mt-2"><summary>{s('Letzte Ausführung','Last execution')} · {job.lastRun.ok ? s('erfolgreich','successful') : s('mit Fehler','failed')}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{[job.lastRun.stdout, job.lastRun.stderr, job.lastRun.note].filter(Boolean).join('\n')}</pre></details>}
    {job.lastPreview&&<details className="mt-2"><summary>{s('Vorschauprüfung','Preview check')} · {job.lastPreview.ok?s('Antwort erhalten','Response received'):s('mit Fehler','failed')}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{[job.lastPreview.stdout,job.lastPreview.stderr].filter(Boolean).join('\n')}</pre></details>}
    {job.lastDiagnostics&&<details className="mt-2"><summary>{s('Codeprüfung','Code diagnostics')} · {job.lastDiagnostics.ok?s('bestanden','passed'):s('offen oder mit Fehler','incomplete or failed')}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{job.lastDiagnostics.detail}</pre></details>}
    {job.lastGit!=null&&<details className="mt-2"><summary>Git</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{JSON.stringify(job.lastGit,null,2)}</pre></details>}
    {job.lastEngine && <details className="mt-2"><summary>Engine · {job.lastEngine.running ? s('gestartet, noch kein Prüfergebnis','started, not yet verified') : job.lastEngine.ok ? s('erfolgreich beendet','finished successfully') : s('mit Fehler','failed')}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{[job.lastEngine.stdout,job.lastEngine.stderr,job.lastEngine.error,job.lastEngine.status].filter(Boolean).join('\n')}</pre></details>}
    {job.lastService&&<details className="mt-2"><summary>{s('Dienst','Service')} · {job.lastService.name} · {job.lastService.ok?s('Antwort erhalten','Response received'):s('mit Fehler','failed')}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{job.lastService.text}</pre></details>}
    {!running&&checking&&<section aria-label={s('Unbestätigte Aktionen prüfen','Review unconfirmed actions')} className="mt-3 min-w-0">
      <p className="text-muted">{s('Beim Fortsetzen prüft Anvil zuerst den aktuellen Stand. Aktionen ohne Rückmeldung bleiben gesperrt und werden nicht wiederholt. Du musst dazu nichts ausfüllen.','On resume, Anvil first checks the current state. Actions without a confirmed result stay blocked and will not be repeated. You do not need to fill anything in.')}</p>
      {!!unconfirmed.length&&<details className="mt-2"><summary>{s('Frühere Aktion selbst klären (optional)','Review a previous action yourself (optional)')} · {unconfirmed.length}</summary>
        <p className="mt-1 text-muted">{s('Nur nötig, wenn du ein gesperrtes Werkzeug wieder freigeben möchtest und den Ausgang selbst geprüft hast. Wenn du es nicht weißt, lass diese Angaben leer und wähle „Stand prüfen und fortsetzen“.','Only needed to unlock a blocked tool after you have checked its outcome yourself. If you do not know, leave this empty and choose “Check state and resume”.')}</p>
        {unconfirmed.map(operation=><OperationReview key={operation.id} operation={operation} en={en} disabled={job.project!==project||operation.status==='started'} />)}
      </details>}
    </section>}
    {!!resolutions.length&&<details className="mt-2"><summary>{s('Geprüfte frühere Aktionen','Reviewed previous actions')} · {resolutions.length}</summary><ul className="mt-1 space-y-2">{resolutions.map(op=><li key={op.id} className="break-words">{op.target} · {op.resolution!.outcome==='confirmed'?s('Ausführung bestätigt','Execution confirmed'):s('Nicht ausgeführt','Not executed')}<br />{op.resolution!.note}</li>)}</ul></details>}
    {(job.textTruncated||job.thinkingTruncated)&&<p className="mt-1 text-muted">{s('Sehr lange Ausgaben wurden für die Speicherung gekürzt. Dateiänderungen bleiben separat gesichert.','Very long output was shortened for storage. File changes remain saved separately.')}</p>}
    {(error || job.error&&!checking || job.persistenceError) && <p role="alert" className="mt-1 text-warn">{error || job.persistenceError||job.error}</p>}
    {job.error&&checking&&<details className="mt-2 text-muted"><summary>{s('Letzte Unterbrechung','Last interruption')}</summary><p className="whitespace-pre-wrap break-words">{job.error}</p></details>}
    {job.project!==project&&<p role="status" className="mt-2 text-warn">{s('Öffne zuerst das Projekt dieses Auftrags.','Open this task’s project first.')}</p>}
    {!running&&job.status!=='done'&&job.operation?.digest&&job.operation.status!=='done'&&!unconfirmed.length&&<details className="mt-2"><summary>{s('Letzte Aktion selbst bestätigen (optional)','Confirm the last action yourself (optional)')}</summary><label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>{s('Ich habe die unbestätigte Aktion und ihren tatsächlichen Zustand geprüft.','I checked the unconfirmed action and its actual state.')}</label></details>}
    {waiting&&<fieldset className="mt-3 rounded border border-border p-2" disabled={sending||blocked}>
      <legend className="px-1 font-medium">{s('Rückfrage','Question')}</legend><p>{waiting.prompt}</p>{waiting.why&&<p className="mt-1 text-muted">{waiting.why}</p>}
      <div className="mt-2 flex flex-wrap gap-2">{waiting.choices.map(choice=><button key={choice.id} className="rounded border border-border px-2 py-1 text-left disabled:opacity-50" onClick={()=>void reply(choice.id)}>{choice.label}{waiting.recommended===choice.id?` · ${s('empfohlen','recommended')}`:''}</button>)}</div>
      {waiting.allowText&&<form className="mt-2 flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();if(answer.trim())void reply();}}><input aria-label={s('Eigene Antwort','Your answer')} className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1" value={answer} onChange={e=>setAnswer(e.target.value)} placeholder={s('Eigene Antwort','Your answer')}/><button disabled={!answer.trim()||sending||blocked}>{s('Antwort senden','Send answer')}</button></form>}
    </fieldset>}
    <div className="mt-2 flex flex-wrap gap-3">
      {running ? <button onClick={() => void stopBackgroundAgent()}>{s('Stoppen','Stop')}</button> : <>
        {job.status!=='done'&&!waiting&&<button disabled={blocked||sending} onClick={()=>void continueTask()}>{checking?s('Stand prüfen und fortsetzen','Check state and resume'):s('Fortsetzen','Resume')}</button>}
        {(paths.length > 0||Object.keys(job.directoryChanges||{}).length>0) && <><button onClick={() => setInspect(!inspect)} aria-expanded={inspect}>{job.writeThrough ? s('Änderungen ansehen','Review changes') : s('Entwürfe ansehen','Review drafts')}</button>{(paths.some(path => !job.drafts[path].applied)||Object.values(job.directoryChanges||{}).some(d=>!d.applied)) && <button onClick={()=>void applyBackgroundDrafts()}>{paths.some(p=>job.drafts[p].after===null)||Object.keys(job.directoryChanges||{}).length?s('Dateiaktionen übernehmen','Apply file actions'):s('Im Editor prüfen','Review in editor')}</button>}</>}
        {!job.restored&&(job.writeThrough||paths.some(p=>job.drafts[p].applied))&&<button onClick={()=>void restoreBackgroundFiles()}>{s('Dateien wiederherstellen','Restore files')}</button>}
        <button onClick={()=>{closeDetails();void dismissBackgroundJob();}}>{s('Ausblenden','Dismiss')}</button>
      </>}
    </div>
    {inspect && <div className="mt-2 max-h-64 overflow-auto">{Object.entries(job.directoryChanges||{}).map(([p,d])=><p key={p}>{s('Ordner','Folder')} {p} · {d.after?s('anlegen','create'):s('entfernen','remove')} · {d.applied?s('gespeichert','saved'):s('Entwurf','draft')}</p>)}{paths.map(path => <details key={path}><summary className="break-words py-1">{path} · {job.drafts[path].applied ? s('Im Projekt gespeichert','Saved in project') : s('Entwurf','Draft')}</summary><details><summary>{s('Vor dem Auftrag','Before the task')}</summary><pre className="overflow-x-auto whitespace-pre text-[11px]">{job.drafts[path].before ?? s('(Neue Datei)','(New file)')}</pre></details><pre className="overflow-x-auto whitespace-pre text-[11px]">{job.drafts[path].after??s('(Datei gelöscht)','(File deleted)')}</pre></details>)}</div>}
    </div>
  </dialog>,document.body)}</>;
}
