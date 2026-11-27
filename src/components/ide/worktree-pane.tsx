import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { companionReadFiles, companionWorktrees } from '@/lib/companion';
import { holdCompanion, releaseCompanion } from '@/lib/companion-life';
import { openOsWorkspace } from '@/lib/workspace-open';
import { foregroundAgentRunning } from '@/lib/background-agent';
import { worktreeActionProblem, worktreeIsCurrent, worktreeSameRoot, withWorktreeProjectLease, type ManagedWorktree, type WorktreeAction, type WorktreeReply } from '@/lib/worktrees';
import { useIde } from '@/store/ide';

export function WorktreePane({ onChanged }: { onChanged?: () => void } = {}) {
  const cwd = useIde(s => s.workspaceCwd), base = useIde(s => s.companionUrl);
  const agentBusy = useIde(s => s.agentBusy), pathOperation = useIde(s => s.pathOperation);
  const foregroundBusy = agentBusy && foregroundAgentRunning();
  const [rows, setRows] = useState<ManagedWorktree[]>([]), [source, setSource] = useState('');
  const [name, setName] = useState(''), [busy, setBusy] = useState(''), [message, setMessage] = useState('');
  const [comparison, setComparison] = useState<WorktreeReply | null>(null), [refresh, setRefresh] = useState(0);
  const active = useRef<AbortController | null>(null);
  const configured = base || 'http://127.0.0.1:7845';

  useEffect(() => {
    const controller = new AbortController(), epoch = useIde.getState().workspaceEpoch;
    active.current?.abort(); active.current = controller;
    setRows([]); setComparison(null); setSource(''); setMessage('');
    if (!cwd) return () => controller.abort();
    setBusy('list');
    void (async () => {
      let held = false;
      try {
        held = await holdCompanion(cwd, configured);
        controller.signal.throwIfAborted();
        const result = await companionWorktrees('list', { cwd }, configured, controller.signal);
        if (controller.signal.aborted || epoch !== useIde.getState().workspaceEpoch) return;
        if (result.ok) { setRows(result.worktrees || []); setSource(result.cwd || cwd); }
        else setMessage(result.error || 'Arbeitsstände konnten nicht geladen werden.');
      } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : String(error)); }
      finally { if (held) await releaseCompanion().catch(() => undefined); if (active.current === controller) { active.current = null; setBusy(''); } }
    })();
    return () => controller.abort();
  }, [cwd, configured, refresh]);

  const act = useCallback(async (action: WorktreeAction, row?: ManagedWorktree) => {
    if (active.current) return;
    const initial = useIde.getState(), epoch = initial.workspaceEpoch;
    const problem = worktreeActionProblem(action, { ...initial, agentBusy: foregroundAgentRunning() }, row, cwd);
    if (problem) { setMessage(problem); initial.setNotice(problem); return; }
    const controller = new AbortController(); active.current = controller; setBusy(action); setMessage('');
    const pathLock = ['integrate', 'remove'].includes(action) ? { from: '', to: '' } : null;
    if (pathLock) useIde.setState({ pathOperation: pathLock });
    let held = false;
    try {
      held = await holdCompanion(cwd, configured); controller.signal.throwIfAborted();
      if (epoch !== useIde.getState().workspaceEpoch) throw Error('Projekt inzwischen gewechselt. Aktion wurde nicht gestartet.');
      const current = useIde.getState();
      const currentProblem = worktreeActionProblem(action, { ...current, agentBusy: foregroundAgentRunning(), pathOperation: current.pathOperation === pathLock ? null : current.pathOperation }, row, cwd);
      if (currentProblem) throw Error(currentProblem);
      const roots = row && ['integrate', 'remove'].includes(action) ? [row.source, row.path] : [];
      const result = await withWorktreeProjectLease(roots, async () => {
        controller.signal.throwIfAborted();
        return companionWorktrees(action, { cwd, ...(row ? { id: row.id } : {}), ...(action === 'create' ? { name: name.trim() || 'Aufgabe' } : {}), ...(action === 'integrate' && comparison?.worktree?.id === row?.id ? { expectedRevision: comparison?.revision } : {}) }, configured, controller.signal);
      });
      if (epoch !== useIde.getState().workspaceEpoch || controller.signal.aborted) return;
      if (action === 'compare' || (!result.ok && result.changes)) {
        setComparison(result);
        if(result.worktree)setRows(previous=>previous.map(worktree=>worktree.id===result.worktree!.id?{...worktree,...result.worktree,dirty:Boolean(worktree.dirty||result.changes?.length||result.conflicts?.length)}:worktree));
      }
      if (!result.ok) { const error = result.error || 'Arbeitsstand-Aktion fehlgeschlagen.'; setMessage(error); useIde.getState().setNotice(error); return; }
      if (action === 'open' && result.worktree) {
        const guard = worktreeActionProblem('open', { ...useIde.getState(), agentBusy: foregroundAgentRunning() }, result.worktree, cwd);
        if (guard) throw Error(guard);
        const opened = await openOsWorkspace(result.worktree.path);
        if (!opened.ok) throw Error(opened.error || 'Arbeitsstand konnte nicht geöffnet werden.');
        useIde.getState().setNotice('Getrennten Arbeitsstand geöffnet. Ein neuer Auftrag arbeitet in diesem Projektordner.');
      } else if (action === 'create') {
        setName(''); setMessage(result.sourceDirty ? 'Arbeitsstand erstellt. Er startet auf dem gespeicherten Commit; Änderungen im Hauptprojekt bleiben dort.' : 'Arbeitsstand erstellt. Öffne ihn, um dort einen eigenen Auftrag zu starten.');
        if (result.worktree) setRows(previous => [...previous, result.worktree!]);
      } else if (action === 'integrate') {
        if (row && worktreeSameRoot(cwd, row.source) && result.applied?.length) {
          const loaded: Record<string, string | null> = {};
          for (let offset = 0; offset < result.applied.length; offset += 64) Object.assign(loaded, await companionReadFiles(result.applied.slice(offset, offset + 64), cwd, configured));
          if (epoch === useIde.getState().workspaceEpoch) {
            const current = useIde.getState(), files = { ...current.files };
            for (const [path, content] of Object.entries(loaded)) { if (content === null) delete files[path]; else files[path] = content; }
            current.applyFiles(files, current.dirs, { keepDirty: true });
          }
        }
        setComparison(null); setMessage(`${result.applied?.length || 0} Datei(en) ins Hauptprojekt zurückgeführt. Der Aufgabenstand bleibt erhalten.`);
        useIde.getState().setNotice('Änderungen ins Hauptprojekt zurückgeführt. Der Aufgabenstand bleibt erhalten.');
      } else if (action === 'remove') { setRows(previous => previous.filter(w => w.id !== row?.id)); if (comparison?.worktree?.id === row?.id) setComparison(null); setMessage('Leeren, unveränderten Arbeitsstand entfernt. Der Git-Branch bleibt erhalten.'); }
      if (['create', 'integrate', 'remove'].includes(action)) onChanged?.();
    } catch (error) { if (!controller.signal.aborted) { const text = error instanceof Error ? error.message : String(error); setMessage(text); useIde.getState().setNotice(text); } }
    finally {
      if (pathLock && useIde.getState().pathOperation === pathLock) useIde.setState({ pathOperation: null });
      if (held) await releaseCompanion().catch(() => undefined);
      if (active.current === controller) { active.current = null; setBusy(''); if (controller.signal.aborted && epoch === useIde.getState().workspaceEpoch) setMessage('Aktion abgebrochen. Bereits erstellte Arbeitsstände und Dateien bleiben erhalten; Status bei Bedarf aktualisieren.'); }
    }
  }, [cwd, configured, name, comparison, onChanged]);

  async function openSource() {
    const problem = worktreeActionProblem('open', { ...useIde.getState(), agentBusy: foregroundAgentRunning() });
    if (problem) { setMessage(problem); return; }
    const result = await openOsWorkspace(source);
    if (!result.ok) setMessage(result.error || 'Hauptprojekt konnte nicht geöffnet werden.');
  }

  if (!cwd) return null;
  const blockWrite = Boolean(busy || foregroundBusy || pathOperation);
  const inspected = comparison?.worktree;
  return <section className="my-4 rounded-md border border-border bg-bg p-2" aria-label="Getrennte Arbeitsstände">
    <details>
    <summary className="cursor-pointer text-xs font-medium text-fg">Getrennte Arbeitsstände{rows.length ? ` · ${rows.length}` : ''}</summary>
    <div className="mt-1 flex items-center justify-end gap-1">
      <Button variant="quiet" className="h-7 px-2 text-[11px]" disabled={Boolean(busy)} onClick={() => setRefresh(n => n + 1)}>Aktualisieren</Button>
    </div>
    <p className="mt-1 text-[11px] text-subtle">Eigener Git-Branch und Projektordner pro Aufgabe. Ausgangspunkt ist der aktuelle Commit.</p>
    {source && !worktreeSameRoot(source, cwd) ? <Button className="mt-2 h-7 px-2 text-xs" disabled={blockWrite} onClick={() => void openSource()}>Hauptprojekt öffnen</Button> : null}
    <form className="mt-2 flex min-w-0 gap-1" onSubmit={event => { event.preventDefault(); void act('create'); }}>
      <input aria-label="Name des Arbeitsstands" className="h-8 min-w-0 flex-1 rounded border border-border bg-surface px-2 text-xs text-fg" placeholder="Name der Aufgabe" maxLength={80} value={name} disabled={Boolean(busy)} onChange={event => setName(event.target.value)} />
      <Button type="submit" className="h-8 px-2 text-xs" disabled={blockWrite}>Erstellen</Button>
    </form>
    {busy ? <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted"><span>{busy === 'list' ? 'Arbeitsstände werden gelesen…' : 'Arbeitsstand-Aktion läuft…'}</span><Button variant="quiet" className="h-7 px-2 text-xs" onClick={() => active.current?.abort()}>Abbrechen</Button></div> : null}
    {message ? <p role="status" className="mt-2 break-words text-xs text-muted">{message}</p> : null}
    {!rows.length && !busy && !message ? <p className="mt-2 text-xs text-subtle">Noch kein Arbeitsstand für dieses Projekt.</p> : null}
    <ul className="mt-2 space-y-2">{rows.map(w => <li key={w.id} className="rounded border border-border p-2">
      <p className="break-words text-xs font-medium text-fg">{w.name}{worktreeIsCurrent(w, cwd) ? ' · Geöffnet' : ''}</p>
      <p title={w.branch} className="mt-0.5 truncate font-mono text-[10px] text-subtle">{w.baseBranch} · {w.baseRevision.slice(0, 8)}</p>
      <p className="mt-1 text-[11px] text-muted">{w.unavailable ? w.error : w.dirty || w.committed ? 'Änderungen im Aufgabenstand' : 'Unveränderter Ausgangsstand'}</p>
      {!w.unavailable && w.state === 'ready' ? <div className="mt-2 flex flex-wrap gap-1">
        <Button className="h-7 px-2 text-[11px]" disabled={blockWrite || worktreeIsCurrent(w, cwd)} onClick={() => void act('open', w)}>Öffnen</Button>
        <Button className="h-7 px-2 text-[11px]" disabled={Boolean(busy)} onClick={() => void act('compare', w)}>Änderungen</Button>
        <Button className="h-7 px-2 text-[11px]" disabled={blockWrite || Boolean(w.dirty || w.committed) || worktreeIsCurrent(w, cwd)} onClick={() => void act('remove', w)}>Leeren Stand entfernen</Button>
      </div> : null}
    </li>)}</ul>
    {comparison && inspected ? <div className="mt-3 border-t border-border pt-2">
      <p className="text-xs font-medium text-fg">{inspected.name} → Hauptprojekt</p>
      <p className="mt-1 text-[11px] text-subtle">Vergleich mit {comparison.baseRevision?.slice(0, 8)}. Rückführung erstellt keinen Commit und ändert den Hauptprojekt-Index nicht.</p>
      {comparison.conflicts?.length ? <div className="mt-2 text-xs text-danger"><p>Konflikte · beide Stände bleiben erhalten</p><ul className="mt-1 space-y-1">{comparison.conflicts.map(conflict => <li key={conflict.path}><span className="break-all font-mono">{conflict.path}</span><p className="text-[11px]">{conflict.reason}</p></li>)}</ul></div> : null}
      <ul className="mt-2 space-y-1">{comparison.changes?.map(change => <li key={change.path}><details className="rounded border border-border px-2 py-1"><summary className="cursor-pointer break-all font-mono text-[11px] text-fg">{change.kind} {change.path}{change.alreadyApplied ? ' · Bereits enthalten' : ''}{change.binary ? ' · Binärdatei' : ''}</summary>
        {change.binary ? <p className="mt-1 text-[11px] text-muted">{change.bytes} Bytes im Aufgabenstand. Inhalt kann hier nicht als Text dargestellt werden.</p> : <>{[['Ausgangsstand', change.beforeText], ['Aufgabenstand', change.afterText], ...(change.conflict ? [['Hauptprojekt', change.currentText]] : [])].map(([label, text]) => <div key={label} className="mt-2"><p className="text-[10px] text-subtle">{label}</p><pre className="max-h-48 overflow-auto whitespace-pre text-[10px] text-fg">{text || '(leer oder entfernt)'}</pre></div>)}</>}
        {change.previewTruncated ? <p className="mt-1 text-[11px] text-muted">Textvorschau gekürzt. Die Rückführung prüft den vollständigen Dateiinhalt.</p> : null}
      </details></li>)}</ul>
      {!comparison.changes?.length && !comparison.conflicts?.length ? <p className="mt-2 text-xs text-subtle">Keine Änderungen gegenüber der Ausgangsrevision.</p> : null}
      <Button className="mt-2 h-8 px-2 text-xs" variant="primary" disabled={blockWrite || !comparison.revision || !comparison.changes?.some(change => !change.alreadyApplied) || Boolean(comparison.conflicts?.length)} onClick={() => void act('integrate', inspected)}>Ins Hauptprojekt rückführen</Button>
    </div> : null}
    </details>
  </section>;
}
