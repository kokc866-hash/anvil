/** Correlate a lost HTTP reply with exactly one process start. Unknown IDs are never an exit receipt. */
export class RunRequests {
  constructor({ max = 512, status } = {}) {
    this.max = max;
    this.status = status;
    this.requests = new Map();
  }
  validate(id) {
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(String(id))) throw new Error('Ungültige Startkennung.');
  }
  async start(id, operation) {
    this.validate(id);
    if (this.requests.has(id)) throw new Error('Diese Startkennung wurde bereits verwendet.');
    // Only completed requests may leave the cache. An active request must remain observable.
    for (const [key, entry] of this.requests) {
      if (this.requests.size < this.max) break;
      if (entry.result && !entry.result.running) this.requests.delete(key);
    }
    if (this.requests.size >= this.max) throw new Error('Zu viele offene Engine-Starts.');
    const entry = {};
    this.requests.set(id, entry);
    try {
      const result = await operation();
      entry.result = { ...result, running: result.running === true, requestId: id };
      return entry.result;
    } catch (error) {
      // The operation must report confirmed spawn failures as a normal result.
      // An unexpected exception cannot establish that a process did not start.
      entry.error = error;
      throw error;
    }
  }
  read(id) {
    this.validate(id);
    const entry = this.requests.get(id);
    if (!entry) throw new Error('Engine-Start nicht bekannt. Sein Ausgang ist nicht bestätigt.');
    if (!entry.result) return { requestId: id, pending: true };
    if (entry.result.running) {
      const current = this.status(entry.result.stage?.id);
      if (current.stage?.id !== entry.result.stage?.id || typeof current.running !== 'boolean') throw new Error('Engine-Status passt nicht zum Start.');
      entry.result = { ...current, requestId: id };
    }
    return entry.result;
  }
}
