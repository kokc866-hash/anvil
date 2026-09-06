/** Coalesces pending edits and keeps all writes/removals in submission order. */
export class WriteQueue {
  private pending = new Map<string, () => Promise<void>>();
  private tail: Promise<void> = Promise.resolve();
  private idle: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;

  private onError: (error: unknown) => void;
  constructor(onError: (error: unknown) => void) {
    this.onError = onError;
  }

  schedule(key: string, write: () => Promise<void>) {
    this.pending.set(key, write);
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.backgroundFlush(), 800);
    this.deadline ??= setTimeout(() => this.backgroundFlush(), 3000);
  }

  cancel(matches: (key: string) => boolean) {
    for (const key of this.pending.keys()) if (matches(key)) this.pending.delete(key);
  }

  private backgroundFlush() {
    void this.flush().catch(this.onError);
  }

  /** Also waits for batches that an earlier flush has already started. */
  flush(): Promise<void> {
    clearTimeout(this.idle);
    clearTimeout(this.deadline);
    this.idle = this.deadline = undefined;
    const batch = [...this.pending.values()];
    this.pending.clear();
    if (!batch.length) return this.tail;
    return this.run(async () => {
      const errors: unknown[] = [];
      for (const write of batch) {
        try {
          await write();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length)
        throw new AggregateError(errors, "Dateien konnten nicht vollständig gespeichert werden.");
    });
  }

  run(operation: () => Promise<void>): Promise<void> {
    const next = this.tail.catch(() => undefined).then(operation);
    this.tail = next;
    void next.catch(() => undefined);
    return next;
  }
}
