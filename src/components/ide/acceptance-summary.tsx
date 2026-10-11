import { acceptanceResult, type AcceptanceResult } from '../../../electron/task-acceptance.mjs';

export function AcceptanceSummary({ value, en = false }: { value?: AcceptanceResult; en?: boolean }) {
  const result = value || acceptanceResult(undefined);
  const labels = en
    ? { unverified: 'Unverified', partial: 'Partially confirmed', passed: 'Passed', failed: 'Failed', stale: 'Recheck required' }
    : { unverified: 'Nicht nachgewiesen', partial: 'Teilweise bestätigt', passed: 'Bestanden', failed: 'Nicht bestanden', stale: 'Erneute Prüfung nötig' };
  const color = result.state === 'passed' ? 'text-ok' : result.state === 'failed' ? 'text-danger' : 'text-muted';
  return <section aria-label={en ? 'Task acceptance' : 'Gesamtabnahme'} data-acceptance-state={result.state} className="my-2 min-w-0 rounded border border-border p-2 text-xs">
    <p className={color}>{en ? 'Task acceptance' : 'Gesamtabnahme'}: <strong>{labels[result.state]}</strong></p>
    <p className="mt-1 text-muted">{en ? 'Evaluated measurements are separate from tool success and task completion.' : 'Messnachweise werden getrennt von Werkzeugerfolg und Auftragsende bewertet.'}</p>
    {!result.criteria.length && <p className="mt-1">{en ? 'No acceptance criteria were fixed before work. A green checklist does not prove acceptance.' : 'Vor Arbeitsbeginn wurden keine Abnahmekriterien festgelegt. Grüne Haken belegen keine Gesamtabnahme.'}</p>}
    {!!result.checks.length && <details className="mt-1">
      <summary>{en ? 'Criteria and evidence' : 'Kriterien und Nachweise'} · {result.checks.filter(c => c.criterion.required && c.state === 'passed').length}/{result.criteria.filter(c => c.required).length} {en ? 'required checks' : 'Pflichtprüfungen'}</summary>
      <ul className="mt-2 space-y-2">{result.checks.map(({ criterion: c, state, observation: o, reason, reasonEn }) => <li key={c.id} className="break-words">
        <p><strong>{c.label}</strong> · {labels[state]}{!c.required ? ` · ${en ? 'optional' : 'optional'}` : ''}</p>
        <p>{en ? 'Expected' : 'Soll'}: {c.operator} {JSON.stringify(c.expected)}{c.tolerance !== undefined ? ` ± ${c.tolerance}` : ''} {c.unit || ''} · {en ? 'Actual' : 'Ist'}: {o ? JSON.stringify(o.actual) : '—'}</p>
        {reason && <p className="mt-1 text-warn">{en ? reasonEn || reason : reason}</p>}
        {o && <p className="text-muted">{o.artifact} · {o.evidence} · {o.tool}<br /><span className="break-all">SHA-256: {o.sha256}</span></p>}
      </li>)}</ul>
    </details>}
    {!!result.changes.length && <details className="mt-2" open>
      <summary>{en ? 'Rejected criterion changes' : 'Abgelehnte Kriterienänderungen'} · {result.changes.length}</summary>
      <ul className="mt-1 space-y-2">{result.changes.map((change, i) => <li key={i} className="break-words">
        <p>{change.reason}</p><p>{en ? 'Not applied; original criteria remain binding.' : 'Nicht angewendet; ursprüngliche Kriterien bleiben verbindlich.'}</p>
        <p className="text-muted">{change.criteria.map(c => `${c.label}: ${c.operator} ${String(c.expected)}${c.tolerance === undefined ? '' : ` ± ${c.tolerance}`} ${c.unit || ''}${c.required ? '' : ' (optional)'}`).join('; ')}</p>
      </li>)}</ul>
    </details>}
    {result.incompleteHistory && <p role="alert" className="mt-1 text-warn">{en ? 'Evidence history is incomplete. Acceptance cannot be confirmed.' : 'Die Nachweishistorie ist unvollständig. Eine bestandene Abnahme kann nicht bestätigt werden.'}</p>}
  </section>;
}
