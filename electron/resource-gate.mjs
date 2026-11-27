import { randomUUID } from 'node:crypto';
import { hasAsciiControl } from './text-controls.mjs';
import { isAbsolute, resolve } from 'node:path';
import { lstatSync, realpathSync, statSync } from 'node:fs';

/** @typedef {{leaseId:string,key:string,owner:string}} ResourceLease */

/** Cross-job/main-window ownership. This gate never queues or retries operations. */
export class JobResourceGate {
  constructor({ maxLeases = 64 } = {}) { /** @type {Map<string,Readonly<ResourceLease>>} */ this.leases = new Map(); this.maxLeases = maxLeases; }
  /** @param {string} owner @param {string} [key] */
  acquire(owner, key = 'external') {
    if (typeof owner !== 'string' || !owner || owner.length > 200 || hasAsciiControl(owner)) throw Error('Ressourcenbesitzer ungültig.');
    if (key !== 'external') throw Error('Unbekannte gemeinsame Ressource.');
    const other = [...this.leases.values()].find(lease => lease.key === key && lease.owner !== owner);
    if (other) throw Error('Gemeinsame Dienst-, Engine- oder Debug-Ressource ist bereits durch einen anderen Auftrag belegt. Aktion wurde nicht ausgeführt.');
    if (this.leases.size >= this.maxLeases || [...this.leases.values()].filter(lease => lease.owner === owner).length >= 16) throw Error('Zu viele offene Ressourcenbindungen. Laufende Aufrufe oder Sitzungen zuerst schließen.');
    const lease = Object.freeze({ leaseId: randomUUID(), key, owner }); this.leases.set(lease.leaseId, lease);
    return lease;
  }
  /** @param {string} leaseId @param {string} owner */
  release(leaseId, owner) {
    const lease = this.leases.get(leaseId);
    if (!lease) return { ok: true, released: false };
    if (lease.owner !== owner) throw Error('Ressourcenbindung gehört zu einem anderen Auftrag.');
    this.leases.delete(leaseId); return { ok: true, released: true };
  }
  /** @param {string} owner */
  releaseOwner(owner) { for (const lease of this.leases.values()) if (lease.owner === owner) this.leases.delete(lease.leaseId); }
  /** @param {string} prefix */
  releasePrefix(prefix) { for (const lease of this.leases.values()) if (lease.owner.startsWith(prefix)) this.leases.delete(lease.leaseId); }
  /** @param {string} [owner] */
  held(owner) { return [...this.leases.values()].some(lease => owner === undefined || lease.owner === owner); }
  snapshot() { return [...this.leases.values()].map(lease => ({ ...lease })); }
  /** @template T @param {string} owner @param {string} key @param {()=>T|Promise<T>} operation @returns {Promise<T>} */
  async run(owner, key, operation) {
    const lease = this.acquire(owner, key);
    try { return await operation(); } finally { this.release(lease.leaseId, owner); }
  }
}

export const sharedAgentResourceGate = new JobResourceGate();

/** Keep Engine/Debug ownership beyond the call while the actual session is alive.
 * @param {any} runtime @param {JobResourceGate} gate @param {string} jobId */
export function guardJobRuntime(runtime, gate, jobId) {
  const owner = `background:${jobId}`, retained = new Set();
  const execute = runtime.execute.bind(runtime), close = runtime.close.bind(runtime), finish = runtime.finish.bind(runtime);
  const begin = runtime.begin?.bind(runtime);
  /** @type {{path:string,identity:string}|null|undefined} */ let projectIdentity;
  /** @param {string} project */
  const identify = project => {
    if (!lstatSync(project).isDirectory()) throw Error('Projektordner wurde ersetzt oder ist eine Verknüpfung.');
    const root = realpathSync(resolve(project)), stat = statSync(root); return `${root}:${stat.dev}:${stat.ino}`;
  };
  runtime.begin = /** @param {{project?:string}} request @param {string} id */ (request, id) => {
    const project=request.project||'';
    projectIdentity = isAbsolute(project) ? { path: project, identity: identify(project) } : null;
    return begin?.(request, id);
  };
  /** @param {Readonly<ResourceLease>} lease */
  const release = lease => { retained.delete(lease); gate.release(lease.leaseId, owner); };
  const releaseIdle = () => {
    if (!runtime.engines?.jobs?.size && !runtime.debugger?.state?.active) for (const lease of retained) release(lease);
  };
  runtime.resourceBusy = () => Boolean(runtime.engines?.jobs?.size || runtime.debugger?.state?.active);
  runtime.execute = /** @param {any} op @param {any} context */ async (op, context) => {
    if (projectIdentity && identify(projectIdentity.path) !== projectIdentity.identity) throw Error('Projektordner des Auftrags wurde verschoben oder ersetzt. Aktion wurde nicht ausgeführt.');
    if (!['mcp', 'cli', 'engine', 'debug'].includes(op.kind)) return execute(op, context);
    releaseIdle(); const lease = gate.acquire(owner, 'external');
    try { return await execute(op, context); }
    finally {
      if (runtime.resourceBusy()) {
        if (retained.size) release(lease); else retained.add(lease);
        const jobs = [...(runtime.engines?.jobs || [])];
        if (jobs.length) Promise.allSettled(jobs.map(job => job.done)).then(releaseIdle);
      } else { release(lease); releaseIdle(); }
    }
  };
  runtime.finish = async () => { try { return await finish(); } finally { releaseIdle(); } };
  runtime.close = async () => { try { return await close(); } finally { releaseIdle(); } };
  return runtime;
}
