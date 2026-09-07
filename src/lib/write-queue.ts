/** Coalesces pending edits and keeps all writes/removals in submission order. */
export class WriteQueue {
  private pending = new Map<string, () => Promise<void>>();
  private versions = new Map<string, number>();
  private failed = new Map<string, () => Promise<void>>();
  private active: Promise<void> = Promise.resolve();
  private tail: Promise<void> = Promise.resolve();
  private idle: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;

  private onError: (error: unknown) => void;
  constructor(onError: (error: unknown) => void) {
    this.onError = onError;
  }

  schedule(key: string, write: () => Promise<void>) {
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
    this.failed.delete(key);
    this.pending.set(key, write);
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.backgroundFlush(), 800);
    this.deadline ??= setTimeout(() => this.backgroundFlush(), 3000);
  }

  cancel(matches: (key: string) => boolean) {
    for (const key of this.versions.keys()) if (matches(key)) this.versions.set(key, this.versions.get(key)! + 1);
    for (const key of this.pending.keys()) if (matches(key)) this.pending.delete(key);
    for (const key of this.failed.keys()) if (matches(key)) this.failed.delete(key);
  }

  private backgroundFlush() {
    void this.flush().catch(this.onError);
  }

  /** Also waits for batches that an earlier flush has already started. */
  flush(): Promise<void> {
    clearTimeout(this.idle);
    clearTimeout(this.deadline);
    this.idle = this.deadline = undefined;
    const batch = new Map([...this.failed, ...this.pending]);
    const versions = new Map(this.versions);
    this.failed.clear();
    this.pending.clear();
    if (!batch.size) return this.active;
    return this.run(async () => {
      const errors: unknown[] = [];
      for (const [key, write] of batch) {
        try {
          await write();
        } catch (error) {
          if (!this.pending.has(key) && versions.get(key) === this.versions.get(key)) this.failed.set(key, write);
          errors.push(error);
        }
      }
      if (errors.length)
        throw new AggregateError(errors, "Dateien konnten nicht vollständig gespeichert werden.\n" + [...new Set(errors.map((e) => e instanceof Error ? e.message : String(e)))].join("\n"));
    });
  }

  run(operation: () => Promise<void>): Promise<void> {
    const next = this.tail.catch(() => undefined).then(operation);
    this.active = next;
    this.tail = next.then(() => undefined, () => undefined);
    void this.tail.then(() => { if (this.active === next) this.active = Promise.resolve(); });
    return next;
  }
}
