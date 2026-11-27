/** Only completed tool observations enter this guard. Model thinking and wall
 * time never count as repetition. Captures, call IDs and log clocks do not buy
 * progress; changing application state, source or assertion targets does. */
export function loopObservation(result: Record<string, unknown>): unknown {
  const state = result.state && typeof result.state === 'object' ? result.state as Record<string, unknown>
    : result.observation && typeof result.observation === 'object' ? result.observation as Record<string, unknown> : undefined;
  const normalize = (value: unknown) => typeof value === 'string' ? value.replace(/\b\d{10,17}\b/g, '<id>').replace(/\b\d{1,2}:\d{2}:\d{2}\b/g, '<clock>').slice(0, 24000) : typeof value === 'number' || typeof value === 'boolean' ? value : undefined;
  const content = Array.isArray(result.content) ? result.content.slice(0, 32).filter(row => row && typeof row === 'object' && row.type === 'text' && typeof row.text === 'string').map(row => row.text.slice(0, 24000)).join('\n') : result.content;
  return { ok: normalize(result.ok), error: typeof result.error === 'string' ? normalize(result.error.replace(/\d+/g, '<n>')) : normalize(result.error), stderr: normalize(result.stderr),
    text: normalize(state?.text ?? content ?? result.stdout), functionalChecks: result.functionalChecks === true,
    elements: Array.isArray(state?.elements) ? state.elements.slice(0, 64).filter((row): row is Record<string, unknown> => !!row && typeof row === 'object').map(row => ({ selector: normalize(row.selector), value: normalize(row.value), checked: normalize(row.checked), disabled: normalize(row.disabled), text: normalize(row.text) })) : undefined,
    observations: Array.isArray(state?.observations) ? state.observations.slice(0, 64).filter((row): row is Record<string, unknown> => !!row && typeof row === 'object').map(row => ({ selector: normalize(row.selector), value: normalize(row.value), text: normalize(row.text) })) : undefined,
  };
}

export class AgentLoopProgress {
  private recent: string[] = [];
  private warningAt = -1;
  private period = 0;
  warning = false;
  stop = false;

  record(key: string, changed = false): void {
    if (changed) { this.recent = []; this.warningAt = -1; this.period = 0; this.stop = false; }
    this.recent.push(key);
    if (this.recent.length > 64) { this.recent.shift(); if (this.warningAt >= 0) this.warningAt--; }
    let period = 0;
    for (let p = 1; p <= Math.min(10, Math.floor(this.recent.length / 3)); p++) {
      const n = this.recent.length;
      if (p * 3 < 6) continue;
      if (this.recent.slice(n - 3 * p).every((v, i, rows) => i < p || v === rows[i % p])) { period = p; break; }
    }
    this.warning = false;
    if (!period) { this.warningAt = -1; this.period = 0; return; }
    if (this.warningAt < 0 || this.period !== period) {
      this.warningAt = this.recent.length; this.period = period; this.warning = true;
    } else if (this.recent.length - this.warningAt >= Math.max(period, 2)) this.stop = true;
  }
}
