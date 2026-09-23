import { useEffect, useState } from 'react';
import { useIde } from '@/store/ide';
import { applyBackgroundDrafts, backgroundRunning, dismissBackgroundJob, restoreBackgroundFiles, resumeBackgroundJob, stopBackgroundAgent, useBackgroundAgent } from '@/lib/background-agent';

export function BackgroundAgentPane() {
  const { job, error } = useBackgroundAgent();
  const en=useIde(s=>s.locale==='en');
  const s=(de:string,enText:string)=>en?enText:de;
  const [inspect, setInspect] = useState(false);
  const [reviewed,setReviewed]=useState(false);
  const [answer,setAnswer]=useState('');
  const [sending,setSending]=useState(false);
  useEffect(()=>{setReviewed(false);setInspect(false);setAnswer('');setSending(false);},[job?.id]);
  if (!job || job.dismissed) return error ? <p role="status" className="p-2 text-xs text-warn">{error}</p> : null;
  const running = backgroundRunning(job), paths = Object.keys(job.drafts);
  const waiting=job.status==='waiting-user'&&job.ask;
  const blocked=Boolean(job.operation?.digest&&job.operation.status!=='done'&&!reviewed);
  async function reply(choiceId?:string){
    if(!job?.ask||sending||blocked)return;
    setSending(true);
    try{await resumeBackgroundJob(reviewed,{askId:job.ask.id,...(choiceId?{choiceId}:{text:answer.trim()})});}
    finally{setSending(false);}
  }
  return <section aria-label={s('Hintergrundauftrag','Background task')} className="mx-3 my-2 min-w-0 rounded-lg border border-border p-3 text-xs">
    <p className="font-medium">{s('Hintergrund-Test','Background test')} · {job.status === 'stopping' ? s('Ausführung wird beendet','Stopping execution') : running ? s('Läuft unabhängig vom Fenster','Runs independently of the window') : waiting?s('Wartet auf deine Antwort','Waiting for your answer'):job.status === 'done' ? s('Auftrag beendet','Task ended') : s('Angehalten','Paused')} · {paths.length} {s(paths.length === 1 ? 'Datei' : 'Dateien',paths.length===1?'file':'files')}</p>
    <p className="mt-1 break-words text-muted">{job.connection}{job.services?.length?` · ${job.services.length} ${s('Dienste','services')}`:''}</p>
    <p className="mt-1 text-muted">{job.writeThrough ? s('Bestätigte Änderungen werden im Projekt gespeichert. Vorherige Inhalte bleiben gesichert.','Acknowledged changes are saved to the project. Previous content remains backed up.') : s('Dateientwürfe werden gesichert und können anschließend im Editor geprüft werden.','Drafts are saved for review in the editor.')} {running && s('Anvil beenden stoppt den Auftrag.','Exiting Anvil stops the task.')}</p>
    {job.operation?.status === 'pending' && <p className="mt-1 break-words text-muted">{job.operation.kind === 'cli'?s('Modellantwort über CLI läuft …','Waiting for the CLI model…'):job.operation.kind==='mcp'?`${s('Dienst','Service')}: ${job.operation.name||s('Katalog laden','Load catalog')}`:`${s('Aktion','Action')}: ${job.operation.path || job.operation.kind}`}</p>}
    {job.pendingRun&&<p className="mt-1">{s('Prüfung läuft','Verification running')}: {job.pendingRun.path}</p>}
    {job.lastRun && <details className="mt-2"><summary>{s('Letzte Ausführung','Last execution')} · {job.lastRun.ok ? s('erfolgreich','successful') : s('mit Fehler','failed')}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{[job.lastRun.stdout, job.lastRun.stderr, job.lastRun.note].filter(Boolean).join('\n')}</pre></details>}
    {job.lastPreview&&<details className="mt-2"><summary>{s('Vorschauprüfung','Preview check')} · {job.lastPreview.ok?s('Antwort erhalten','Response received'):s('mit Fehler','failed')}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{[job.lastPreview.stdout,job.lastPreview.stderr].filter(Boolean).join('\n')}</pre></details>}
    {job.lastDiagnostics&&<details className="mt-2"><summary>{s('Codeprüfung','Code diagnostics')} · {job.lastDiagnostics.ok?s('bestanden','passed'):s('offen oder mit Fehler','incomplete or failed')}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{job.lastDiagnostics.detail}</pre></details>}
    {job.lastGit!=null&&<details className="mt-2"><summary>Git</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{JSON.stringify(job.lastGit,null,2)}</pre></details>}
    {job.lastEngine && <details className="mt-2"><summary>Engine · {job.lastEngine.running ? s('gestartet, noch kein Prüfergebnis','started, not yet verified') : job.lastEngine.ok ? s('erfolgreich beendet','finished successfully') : s('mit Fehler','failed')}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{[job.lastEngine.stdout,job.lastEngine.stderr,job.lastEngine.error,job.lastEngine.status].filter(Boolean).join('\n')}</pre></details>}
    {job.lastService&&<details className="mt-2"><summary>{s('Dienst','Service')} · {job.lastService.name} · {job.lastService.ok?s('Antwort erhalten','Response received'):s('mit Fehler','failed')}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{job.lastService.text}</pre></details>}
    {(job.textTruncated||job.thinkingTruncated)&&<p className="mt-1 text-muted">{s('Sehr lange Ausgaben wurden für die Speicherung gekürzt. Dateiänderungen bleiben separat gesichert.','Very long output was shortened for storage. File changes remain saved separately.')}</p>}
    {(error || job.error || job.persistenceError) && <p role="alert" className="mt-1 text-warn">{error || job.persistenceError||job.error}</p>}
    {!running&&job.status!=='done'&&job.operation?.digest&&job.operation.status!=='done'&&<label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>{s('Ich habe die unbestätigte Aktion und ihren tatsächlichen Zustand geprüft.','I checked the unconfirmed action and its actual state.')}</label>}
    {waiting&&<fieldset className="mt-3 rounded border border-border p-2" disabled={sending||blocked}>
      <legend className="px-1 font-medium">{s('Rückfrage','Question')}</legend><p>{waiting.prompt}</p>{waiting.why&&<p className="mt-1 text-muted">{waiting.why}</p>}
      <div className="mt-2 flex flex-wrap gap-2">{waiting.choices.map(choice=><button key={choice.id} className="rounded border border-border px-2 py-1 text-left disabled:opacity-50" onClick={()=>void reply(choice.id)}>{choice.label}{waiting.recommended===choice.id?` · ${s('empfohlen','recommended')}`:''}</button>)}</div>
      {waiting.allowText&&<form className="mt-2 flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();if(answer.trim())void reply();}}><input aria-label={s('Eigene Antwort','Your answer')} className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1" value={answer} onChange={e=>setAnswer(e.target.value)} placeholder={s('Eigene Antwort','Your answer')}/><button disabled={!answer.trim()||sending||blocked}>{s('Antwort senden','Send answer')}</button></form>}
    </fieldset>}
    <div className="mt-2 flex flex-wrap gap-3">
      {running ? <button onClick={() => void stopBackgroundAgent()}>{s('Stoppen','Stop')}</button> : <>
        {job.status!=='done'&&!waiting&&<button disabled={blocked||sending} onClick={()=>void resumeBackgroundJob(reviewed)}>{s('Fortsetzen','Resume')}</button>}
        {(paths.length > 0||Object.keys(job.directoryChanges||{}).length>0) && <><button onClick={() => setInspect(!inspect)} aria-expanded={inspect}>{job.writeThrough ? s('Änderungen ansehen','Review changes') : s('Entwürfe ansehen','Review drafts')}</button>{(paths.some(path => !job.drafts[path].applied)||Object.values(job.directoryChanges||{}).some(d=>!d.applied)) && <button onClick={()=>void applyBackgroundDrafts()}>{paths.some(p=>job.drafts[p].after===null)||Object.keys(job.directoryChanges||{}).length?s('Dateiaktionen übernehmen','Apply file actions'):s('Im Editor prüfen','Review in editor')}</button>}</>}
        {!job.restored&&(job.writeThrough||paths.some(p=>job.drafts[p].applied))&&<button onClick={()=>void restoreBackgroundFiles()}>{s('Dateien wiederherstellen','Restore files')}</button>}
        <button title={s('Auftrag ausblenden. Seine Entwürfe werden beim nächsten Hintergrundauftrag ersetzt.','Hide this task. Its drafts will be replaced by the next background task.')} onClick={() => void dismissBackgroundJob()}>{s('Abschließen','Finish')}</button>
      </>}
    </div>
    {inspect && <div className="mt-2 max-h-64 overflow-auto">{Object.entries(job.directoryChanges||{}).map(([p,d])=><p key={p}>{s('Ordner','Folder')} {p} · {d.after?s('anlegen','create'):s('entfernen','remove')} · {d.applied?s('gespeichert','saved'):s('Entwurf','draft')}</p>)}{paths.map(path => <details key={path}><summary className="break-words py-1">{path} · {job.drafts[path].applied ? s('Im Projekt gespeichert','Saved in project') : s('Entwurf','Draft')}</summary><details><summary>{s('Vor dem Auftrag','Before the task')}</summary><pre className="overflow-x-auto whitespace-pre text-[11px]">{job.drafts[path].before ?? s('(Neue Datei)','(New file)')}</pre></details><pre className="overflow-x-auto whitespace-pre text-[11px]">{job.drafts[path].after??s('(Datei gelöscht)','(File deleted)')}</pre></details>)}</div>}
  </section>;
}
