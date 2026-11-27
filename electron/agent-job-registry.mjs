import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, lstatSync, readFileSync, realpathSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { JobResourceGate } from './resource-gate.mjs';
export { JobResourceGate } from './resource-gate.mjs';

const key = p => process.platform === 'win32' ? p.toLowerCase() : p;
const overlap = (a, b) => a === b || a.startsWith(b + sep) || b.startsWith(a + sep);
const validKey = p => typeof p === 'string' && (p === 'legacy' || /^[a-f0-9-]{36}$/.test(p));
const modelBinding = model => JSON.stringify([model?.provider || '', model?.baseUrl || '', model?.model || '', model?.cliKind || '']);
const rootIdentity = root => { if (!root) return ''; const stat = statSync(root); return `${stat.dev}:${stat.ino}`; };

function projectRoot(project) {
  if (typeof project !== 'string' || !isAbsolute(project)) return '';
  if (!lstatSync(project).isDirectory()) throw Error('Projektordner fehlt oder ist eine Verknüpfung.');
  return realpathSync(resolve(project));
}
function save(file, value) {
  const tmp = file + '.tmp'; mkdirSync(resolve(file, '..'), { recursive: true });
  const fd = openSync(tmp, 'w', 0o600);
  try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, file);
}

/** Stable job selector around independent one-job hosts. Saved snapshots never migrate in-place. */
export class AgentJobRegistry extends EventEmitter {
  constructor({ directory, createHost, gate = new JobResourceGate(), maxParallel = 2 }) {
    super(); this.directory = resolve(directory); this.file = join(this.directory, 'registry.json'); this.createHost = createHost;
    this.gate = gate; this.maxParallel = Math.min(2, Math.max(1, maxParallel)); this.entries = new Map(); this.projectLeases = new Map(); this.selectedJobId = ''; this.queue = Promise.resolve();
    try {
      if (existsSync(this.file)) {
        if (lstatSync(this.file).isSymbolicLink() || lstatSync(this.file).size > 1024 * 1024) throw Error('Registrierung zu groß oder ungültig.');
        const registry = JSON.parse(readFileSync(this.file, 'utf8'));
        if (registry.schema !== 1 || !Array.isArray(registry.jobs) || registry.jobs.length > 128) throw Error('Ungültige Registrierung.');
        for (const row of registry.jobs) {
          if (!validKey(row.jobId) || this.entries.has(row.jobId) || typeof row.project !== 'string' || typeof row.root !== 'string' || typeof row.model !== 'string' || row.rootIdentity !== undefined && typeof row.rootIdentity !== 'string') throw Error('Ungültige Auftragszuordnung.');
          this.add(row);
        }
        const savedSelection = registry.selectedJobId;
        this.selectedJobId = savedSelection === '' || this.entries.has(savedSelection)
          ? savedSelection : this.entries.keys().next().value || '';
      } else if (existsSync(join(this.directory, 'latest.json'))) {
        const row = { jobId: 'legacy', project: '', root: '', model: '' };
        const entry = this.add(row); row.project = entry.host.state?.project || '';
        try { row.root = projectRoot(row.project); row.rootIdentity = rootIdentity(row.root); } catch { row.root = ''; }
        const cliKind = entry.host.state?.connection?.endsWith(' CLI') ? entry.host.state.connection.slice(0, -4) : '';
        row.model = modelBinding({ ...entry.host.state?.modelTarget, cliKind }); this.selectedJobId = row.jobId; this.persist();
      }
    } catch (error) { this.recoveryError = `Gesicherte Auftragsregistrierung konnte nicht gelesen werden: ${String(error.message || error)}`; }
  }
  add(row) {
    const snapshotPath = row.jobId === 'legacy' ? join(this.directory, 'latest.json') : join(this.directory, 'jobs', row.jobId, 'latest.json');
    const host = this.createHost({ jobId: row.jobId, snapshotPath, gate: this.gate });
    const entry = { row, host }; this.entries.set(row.jobId, entry);
    host.on?.('change', () => this.emit('change', row.jobId)); return entry;
  }
  persist() {
    if (this.recoveryError) throw Error(this.recoveryError);
    try { save(this.file, { schema: 1, selectedJobId: this.selectedJobId, jobs: [...this.entries.values()].map(entry => entry.row) }); }
    catch (error) { this.recoveryError = `Auftragsregistrierung konnte nicht gespeichert werden: ${String(error.message || error)}`; throw Error(this.recoveryError); }
  }
  get state() { return this.entries.get(this.selectedJobId)?.host.state || null; }
  busy() { return [...this.entries.values()].some(entry => entry.reserved || entry.host.busy()); }
  occupied(entry) { return entry.reserved || entry.host.busy() || entry.host.cleanup || entry.host.runtime?.resourceBusy?.(); }
  async serial(operation) {
    const previous = this.queue; let release; this.queue = new Promise(r => { release = r; }); await previous;
    try { return await operation(); } finally { release(); }
  }
  hostFor(payload = {}) {
    const id = payload.id || payload.resumeId;
    let entry;
    if (payload.jobId !== undefined) {
      entry = this.entries.get(payload.jobId); if (!entry) throw Error('Unbekannter Hintergrundauftrag.');
      if (id && id !== entry.host.state?.id) throw Error('Auftrag inzwischen verändert oder ID gehört zu einem anderen Auftrag.');
    } else if (id) {
      entry = [...this.entries.values()].find(e => e.host.state?.id === id);
      if (!entry) throw Error('Auftrag inzwischen verändert oder nicht mehr vorhanden.');
    } else entry = this.entries.get(this.selectedJobId);
    return entry?.host || null;
  }
  jobIdFor(host) { return [...this.entries].find(([, entry]) => entry.host === host)?.[0] || ''; }
  wrap(host, reply) { return { ...reply, jobId: this.jobIdFor(host), selectedJobId: this.selectedJobId }; }
  snapshot(id, revision, draftRevision, jobId) {
    // An old revision acknowledgement must not silently target a different job.
    let host;
    try { host = this.hostFor(jobId !== undefined ? { jobId } : id ? { id } : {}); }
    catch (error) { if (jobId !== undefined) throw error; host = this.hostFor(); }
    return this.wrap(host, host ? host.snapshot(id, revision, draftRevision) : { state: null, error: this.recoveryError });
  }
  jobs() {
    return { maxParallel: this.maxParallel, selectedJobId: this.selectedJobId, ...(this.recoveryError ? { error: this.recoveryError } : {}), jobs: [...this.entries].map(([jobId, { host, row, reserved }]) => ({
      jobId, id: host.state?.id || '', project: host.state?.project || row.project, status: host.state?.status || 'empty', busy: Boolean(reserved || host.busy()), resourceBusy: Boolean(host.runtime?.resourceBusy?.()),
      surface: host.runtime?.connections?.surface ? structuredClone(host.runtime.connections.surface) : undefined,
      services: (host.state?.services || []).map(service => ({ id: service.id, name: service.name })),
      prompt: host.state?.prompt || '', modelTarget: host.state?.modelTarget ? { ...host.state.modelTarget } : undefined, revision: host.state?.revision || 0, dismissed: host.state?.dismissed === true, startedAt: host.state?.startedAt,
    })) };
  }
  select(jobId, expectedJobId) {
    if (jobId === '') {
      const selected = this.entries.get(this.selectedJobId);
      if (expectedJobId !== undefined) {
        if (expectedJobId !== this.selectedJobId) return this.wrap(selected?.host, { error: 'Die Auftragsauswahl wurde inzwischen geändert.' });
        if (selected && (this.occupied(selected) || selected.host.state?.status === 'waiting-user')) {
          return this.wrap(selected.host, { error: 'Der ausgewählte Auftrag ist noch aktiv oder wartet auf eine Antwort.' });
        }
      }
      const previous = this.selectedJobId;
      if (previous) {
        this.selectedJobId = '';
        try { this.persist(); }
        catch (error) { this.selectedJobId = previous; throw error; }
        this.emit('change', '');
      }
      return this.wrap(null, { state: null });
    }
    if (!this.entries.has(jobId)) throw Error('Unbekannter Hintergrundauftrag.');
    this.selectedJobId = jobId; this.persist(); const host = this.entries.get(jobId).host; this.emit('change', jobId); return this.wrap(host, host.snapshot());
  }
  assertStart(root, except) {
    if (this.recoveryError) throw Error(this.recoveryError);
    const active = [...this.entries.values()].filter(entry => entry !== except && this.occupied(entry));
    if ([...this.projectLeases.values()].some(lease => !root || lease.projects.some(project => overlap(key(root), key(project))))) throw Error('Eine Dateiaktion am Projekt läuft noch. Auftrag erst nach deren Abschluss starten.');
    if (active.some(entry => root && entry.row.root && overlap(key(root), key(entry.row.root)))) throw Error('Projektwurzeln überlappen. Pro Dateistand darf nur ein Auftrag schreiben.');
    if (active.length && (!root || active.some(entry => !entry.row.root))) throw Error('Parallele Aufträge benötigen getrennte, erreichbare reale Projektordner.');
    if (active.length >= this.maxParallel) throw Error('Höchstens zwei getrennte Hintergrundaufträge dürfen gleichzeitig laufen.');
  }
  assertWriteHost(host) {
    const entry = this.entries.get(this.jobIdFor(host));
    if (!entry) throw Error('Unbekannter Hintergrundauftrag.');
    const root = projectRoot(host.state?.project);
    if (key(root) !== key(entry.row.root)) throw Error('Projektordner des Auftrags wurde verändert.');
    if (entry.row.rootIdentity && rootIdentity(root) !== entry.row.rootIdentity) throw Error('Projektordner des Auftrags wurde ersetzt. Dateiaktion wurde nicht ausgeführt.');
    if ([...this.projectLeases.values()].some(lease => lease.projects.some(project => root && overlap(key(root), key(project))))) throw Error('Eine Dateiaktion am Projekt läuft noch. Änderungen anschließend übernehmen.');
    const other = [...this.entries.values()].find(e => e !== entry && this.occupied(e) && root && e.row.root && overlap(key(root), key(e.row.root)));
    if (other) throw Error('Projekt wird gerade von einem anderen Auftrag bearbeitet. Änderungen erst nach dessen Abschluss übernehmen.');
  }
  acquireWorkspace(projects, owner) {
    if (typeof owner !== 'string' || !owner || owner.length > 200 || !Array.isArray(projects) || !projects.length || projects.length > 4) throw Error('Ungültige Projektbindung.');
    if (this.projectLeases.size >= 32) throw Error('Zu viele offene Projektbindungen. Dateiaktionen zuerst abschließen.');
    const roots = [...new Set(projects.map(project => projectRoot(project)))];
    if (roots.some(root => !root)) throw Error('Dateiaktionen benötigen reale Projektordner.');
    const active = [...this.entries.values()].filter(entry => this.occupied(entry));
    if (active.some(entry => !entry.row.root || roots.some(root => overlap(key(root), key(entry.row.root))))) throw Error('Projekt wird von einem aktiven Hintergrundauftrag bearbeitet. Dateiaktion erst nach dessen Abschluss ausführen.');
    if ([...this.projectLeases.values()].some(lease => lease.owner !== owner && roots.some(root => lease.projects.some(project => overlap(key(root), key(project)))))) throw Error('Eine andere Dateiaktion belegt diesen Projektordner.');
    const lease = { leaseId: randomUUID(), owner, projects: roots }; this.projectLeases.set(lease.leaseId, lease); return { ...lease };
  }
  releaseWorkspace(leaseId, owner) {
    const lease = this.projectLeases.get(leaseId); if (!lease) return { ok: true, released: false };
    if (lease.owner !== owner) throw Error('Projektbindung gehört zu einer anderen Dateiaktion.');
    this.projectLeases.delete(leaseId); return { ok: true, released: true };
  }
  releaseWorkspacePrefix(prefix) { for (const lease of this.projectLeases.values()) if (lease.owner.startsWith(prefix)) this.projectLeases.delete(lease.leaseId); }
  async start(request) {
    // Bind request data before the first await. No later renderer switch can replace it.
    const captured = structuredClone(request), root = projectRoot(captured.project), identity = rootIdentity(root);
    if (root) captured.project = root;
    if(captured.continuationId!==undefined){
      const host=this.hostFor({id:captured.continuationId});
      if(!host)throw Error('Der fortzusetzende Auftrag fehlt.');
      const entry=this.entries.get(this.jobIdFor(host));
      if(captured.project!==entry.row.project||key(root)!==key(entry.row.root))throw Error('Fortsetzen nur im ursprünglichen Projektordner.');
      if(entry.row.rootIdentity&&entry.row.rootIdentity!==identity)throw Error('Ursprünglicher Projektordner wurde ersetzt. Für den neuen Ordner einen neuen Auftrag starten.');
      if(modelBinding(captured.model)!==entry.row.model)throw Error('Modell und Verbindung sind an diesen Auftrag gebunden. Für ein anderes Modell einen neuen Auftrag starten.');
      if(host.state?.status!=='done')return this.resume(captured.continuationId,captured,entry.row.jobId);
      // A short continuation after an ended task still belongs to its source
      // ownership. A substantive new task sends no continuation ID.
      captured.fileProtections=host.continuationProtections(captured);
    }
    return this.serial(async () => {
      this.assertStart(root);
      // Dismissed results keep their snapshot on disk. Reclaim their live slot
      // before enforcing the catalogue bound, so "Ausblenden" actually frees it.
      for(const [id,entry] of this.entries)if(entry.host.state?.dismissed&&!this.occupied(entry))this.entries.delete(id);
      if (this.entries.size >= 128) throw Error('Zu viele gespeicherte Aufträge. Alte Ergebnisse zuerst schließen.');
      const jobId = randomUUID(), row = { jobId, project: captured.project || '', root, rootIdentity: identity, model: modelBinding(captured.model) };
      const previous = this.entries.has(this.selectedJobId) ? this.selectedJobId : '';
      const entry = this.add(row); entry.reserved = true; this.selectedJobId = jobId;
      try {
        this.persist(); await entry.host.waitForCleanup();
        const result = entry.host.start(captured); entry.reserved = false; this.emit('change', jobId); return this.wrap(entry.host, result);
      } catch (error) {
        entry.reserved = false;
        if (!entry.host.state) {
          this.entries.delete(jobId);
          if (this.selectedJobId === jobId) this.selectedJobId = previous;
          if (!this.recoveryError) this.persist();
        }
        throw error;
      }
    });
  }
  async resume(id, request, jobId) {
    const captured = structuredClone(request), root = projectRoot(captured.project);
    if (root) captured.project = root;
    return this.serial(async () => {
      const host = this.hostFor({ ...(jobId !== undefined ? { jobId } : {}), id }); if (!host) throw Error('Hintergrundauftrag fehlt.');
      const entry = this.entries.get(this.jobIdFor(host));
      if (key(root) !== key(entry.row.root) || captured.project !== entry.row.project) throw Error('Fortsetzen nur im ursprünglichen Projektordner.');
      if (entry.row.rootIdentity && rootIdentity(root) !== entry.row.rootIdentity) throw Error('Ursprünglicher Projektordner wurde ersetzt. Für den neuen Ordner einen neuen Auftrag starten.');
      if (modelBinding(captured.model) !== entry.row.model) throw Error('Modell und Verbindung sind an diesen Auftrag gebunden. Für ein anderes Modell einen neuen Auftrag starten.');
      this.assertStart(root, entry); entry.reserved = true;
      try {
        await host.waitForCleanup(); const result = host.resume(id, captured); this.selectedJobId = entry.row.jobId; this.persist(); return this.wrap(host, result);
      } finally { entry.reserved = false; }
    });
  }
  stop(reason, jobId) { const host = this.hostFor(jobId === undefined ? {} : { jobId }); return this.wrap(host, host?.stop(reason) || { state: null }); }
  async waitForCleanup() { await Promise.all([...this.entries.values()].map(entry => entry.host.waitForCleanup())); }
  async close() {
    const results = await Promise.allSettled([...this.entries.values()].map(entry => entry.host.close()));
    if (!this.recoveryError && this.entries.size) this.persist(); return results;
  }
}
