import { useState } from 'react';
import { X, Unplug } from 'lucide-react';
import { useIde } from '@/store/ide';
import { backgroundRunning, closeBackgroundResources, selectBackgroundJob, useBackgroundAgent } from '@/lib/background-agent';

// Navigation belongs in the header. No continuation/review card or dialog.
export function BackgroundTaskSelector() {
  const { job, jobs, selectedJobId } = useBackgroundAgent();
  const en = useIde(s => s.locale === 'en');
  const [closing, setClosing] = useState(false);
  const visible = jobs.filter(item => !item.dismissed);
  const resourceBusy = !backgroundRunning(job) && jobs.some(item => item.jobId === selectedJobId && item.resourceBusy);
  const showSelector = visible.length > 1 || visible.length === 1 && !selectedJobId;
  if (!showSelector && !resourceBusy) return null;
  return <>
    {showSelector && <select aria-label={en ? 'Select background task' : 'Hintergrundauftrag auswählen'} value={selectedJobId || ''} className="min-w-0 max-w-40 truncate rounded border border-border bg-bg px-1 py-1 text-xs" onChange={event => void selectBackgroundJob(event.target.value).catch(error => useIde.getState().setNotice(String(error)))}>
      <option value="" disabled>{en ? 'Current session' : 'Aktuelle Sitzung'}</option>
      {visible.map(item => <option key={item.jobId} value={item.jobId}>{item.busy ? (en ? 'Running' : 'Läuft') : (en ? 'Saved' : 'Gesichert')} · {item.project?.replaceAll('\\', '/').split('/').at(-1) || (en ? 'Session' : 'Sitzung')} · {(item.prompt || '').slice(0, 70)}</option>)}
    </select>}
    {resourceBusy && <button type="button" disabled={closing} aria-label={en ? 'End session' : 'Sitzung beenden'} title={en ? 'End session' : 'Sitzung beenden'} className="shrink-0 rounded p-1 text-muted hover:bg-hover disabled:opacity-50" onClick={() => {
      setClosing(true);
      void closeBackgroundResources().catch(error => useIde.getState().setNotice(String(error))).finally(() => setClosing(false));
    }}><Unplug className="size-4" /></button>}
  </>;
}

export function BackgroundStartError() {
  const failure = useBackgroundAgent(s => s.startFailure);
  const error = useBackgroundAgent(s => s.error);
  const jobProject = useBackgroundAgent(s => s.job?.project);
  const project = useIde(s => s.workspaceCwd || s.memoryWorkspace);
  const en = useIde(s => s.locale === 'en');
  const message = failure?.project === project ? failure.message : !jobProject || jobProject === project ? error : '';
  if (!message) return null;
  return <div role="alert" className="mb-1 flex items-start gap-2 px-1 text-xs text-warn">
    <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{message}</p>
    <button type="button" className="shrink-0 rounded p-0.5 hover:bg-hover" aria-label={en ? 'Dismiss message' : 'Meldung ausblenden'} onClick={() => useBackgroundAgent.setState({ startFailure: null, error: '' })}><X className="size-3.5" /></button>
  </div>;
}
