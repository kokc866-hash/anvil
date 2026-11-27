import { toolResultFailed, toolResultPending } from './agent-evidence.ts';

type Result = Record<string, unknown>;
type Failure = { signature: string; count: number; stamp: string; inspected: boolean };
const source = /\.(?:html?|[cm]?[jt]sx?|py|c|cpp|cc|h|hpp|cs|go|rs|java|rb|php|gd|tscn|tres|css|scss|glsl|shader|md|txt|json)$/i;

function localPath(value: string): string | undefined {
  const parts: string[] = [];
  for (const part of value.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return; parts.pop(); }
    else parts.push(part);
  }
  return parts.join('/');
}

function references(from: string, content: string, files: Record<string, string>): string[] {
  const specs: string[] = [];
  const patterns = [/(?:\b(?:import|export)\s+(?:[^;\n]*?\s+from\s*)?|\b(?:import|require|fetch)\s*\(\s*)["']([^"']+)["']/g,
    /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi];
  for (const pattern of patterns) for (const match of content.slice(0, 128000).matchAll(pattern)) if (specs.length < 96) specs.push(match[1]);
  const result = new Set<string>(), dir = from.split('/').slice(0, -1).join('/');
  for (const spec of specs) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(spec)) continue;
    const raw = spec.replace(/[?#].*$/, '');
    const joined = localPath(raw.startsWith('/') ? raw.slice(1) : raw.startsWith('@/') ? `src/${raw.slice(2)}` : `${dir ? dir + '/' : ''}${raw}`);
    if (!joined) continue;
    const found = [joined, ...['.ts','.tsx','.js','.jsx','.mjs','.cjs','.py','.gd','/index.ts','/index.js','/__init__.py'].map(suffix => joined + suffix)]
      .find(candidate => typeof files[candidate] === 'string');
    if (found) result.add(found);
  }
  return [...result];
}

/** Task-local loop prevention; no new job budget or external-action replay. */
export class AgentRepair {
  private failures = new Map<string, Failure>();
  private previous = new Map<string, Result>();
  private getFiles?: () => Record<string, string>;

  constructor(getFiles?: () => Record<string, string>) { this.getFiles = getFiles; }

  get needsInspection() { return [...this.failures.values()].some(f => f.count >= 2 && !f.inspected); }

  private target(name: string, args: Result) {
    return name === 'run_file' && typeof args.path === 'string' ? localPath(args.path) : undefined;
  }

  private inspected(name: string, args: Result, result: Result): void {
    if (!this.needsInspection || !['read_file', 'grep'].includes(name)) return;
    const current = this.getFiles?.();
    const files = current ? Object.fromEntries(Object.entries(current).flatMap(([path, content]) => {
      const normalized = localPath(path); return normalized && typeof content === 'string' ? [[normalized, content]] : [];
    })) : undefined;
    const edges = new Map<string, string[]>();
    const read = name === 'read_file' && typeof args.path === 'string' ? localPath(args.path) : undefined;
    const query = name === 'grep' ? String(args.query || args.pattern || args.text || '').trim() : '';
    const hits = name === 'grep' && Array.isArray(result.matches) ? result.matches.flatMap(hit => {
      const match = typeof hit === 'string' ? /^(.+?):\d+:(.*)$/.exec(hit) : null;
      const path = match && localPath(match[1]); return path && source.test(path) && (!files || typeof files[path] === 'string') ? [path] : [];
    }) : [];
    for (const [target, failure] of this.failures) {
      if (failure.count < 2 || failure.inspected) continue;
      const reachable = new Set<string>(), pending = [target];
      while (pending.length && reachable.size < 256) {
        const path = pending.pop()!;
        if (reachable.has(path) || files && typeof files[path] !== 'string') continue;
        reachable.add(path);
        if (files) {
          if (!edges.has(path)) edges.set(path, references(path, files[path], files));
          for (const dependency of edges.get(path)!) if (!reachable.has(dependency)) pending.push(dependency);
        }
      }
      // This confirms inspection of a related source/contract, not that the
      // model understood the cause or that a subsequent correction is right.
      if (read && source.test(read) && reachable.has(read)
        || query.length >= 2 && hits.some(path => reachable.has(path)
          || files && query.length >= 3 && failure.signature.toLowerCase().includes(query.toLowerCase()))) failure.inspected = true;
    }
  }

  cached(name: string, args: Result, stamp: string): Result | undefined {
    const target = this.target(name, args);
    const failure = target && this.previous.get(`${target}:${stamp}`);
    return failure ? { ...failure, reusedFailure: true,
      note: 'Unveränderter Dateistand bereits mit diesem Fehler geprüft. Kein weiterer Programmstart. Ursache zuerst untersuchen.' } : undefined;
  }

  blockEdit(path: unknown): string | undefined {
    return this.needsInspection && typeof path === 'string' && source.test(path) && !/\.(?:md|txt)$/i.test(path)
      ? 'Derselbe Ausführungsfehler blieb nach einer Korrektur bestehen. Vor einer weiteren Änderung die betroffene Datei oder Schnittstelle mit read_file/grep gezielt prüfen. Der Auftrag kann danach weitergehen.'
      : undefined;
  }

  guidance(): string {
    return 'Derselbe Fehler besteht nach einer Korrektur weiter. Keine weitere Vermutung patchen: Lies die betroffene Implementierung und den tatsächlichen Schnittstellenvertrag. Prüfe Eingaben, Aufrufreihenfolge und Callback-Bindung. Ändere danach nur die belegte Ursache und teste den richtigen Einstieg. Bereits bestätigte andere Arbeit bleibt erhalten.';
  }

  record(name: string, args: Result, result: Result, stamp: string) {
    if (result.reusedFailure) return;
    if (!toolResultFailed(result) && !toolResultPending(result)) {
      // A real command may have changed dependencies or another execution
      // prerequisite without editing tracked source. Permit a fresh check.
      if (name === 'shell' || name === 'engine_run') this.previous.clear();
      this.inspected(name, args, result);
    }
    const target = this.target(name, args);
    if (!target || toolResultPending(result)) return;
    if (!toolResultFailed(result)) { this.failures.delete(target); return; }
    if (result.aborted || result.timedOut || result.cancelled || result.interrupted || result.definitelyNotExecuted) return;
    const diagnostic = String(result.stderr || result.error || result.stdout || '').trim();
    if (!diagnostic || /fetch failed|network|socket|ECONN|ETIMEDOUT|timed? ?out|aborted/i.test(diagnostic)) return;
    const signature = diagnostic.replace(/0x[0-9a-f]+/gi, '<address>').replace(/:\d+(?::\d+)?/g, ':<line>').slice(0, 1600);
    const prior = this.failures.get(target);
    if (prior?.stamp !== stamp) this.failures.set(target, { signature, count: prior?.signature === signature ? prior.count + 1 : 1, stamp, inspected: false });
    const saved: Result = { ok: false };
    for (const key of ['error', 'stderr', 'stdout', 'code', 'stage']) {
      const value = result[key];
      if (value !== undefined) saved[key] = typeof value === 'string' ? value.slice(0, 24000) : value;
    }
    this.previous.set(`${target}:${stamp}`, saved);
    while (this.previous.size > 16) this.previous.delete(this.previous.keys().next().value!);
    while (this.failures.size > 64) this.failures.delete(this.failures.keys().next().value!);
  }
}
