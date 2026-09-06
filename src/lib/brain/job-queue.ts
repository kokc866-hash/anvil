export type BrainPri = 0 | 1 | 2;

type Job = {
  pri: BrainPri;
  key: string;
  ms: number;
  fn: (signal: AbortSignal) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  ctrl: AbortController;
  timer: ReturnType<typeof setTimeout>;
};

const unavailable = () => Object.assign(new Error("Helfer nach Zeitlimit noch nicht verfügbar."), { name: "BrainUnavailable" });

/** Queue wait and execution each have bounded budgets. A timed-out engine stays quarantined until it
 * settles or its owner disposes it and resets the queue. Never overlap GPU jobs. */
export class BrainJobQueue {
  private pending: Job[] = [];
  private active: Job | null = null;
  private held = false;
  private onBusy: (busy: boolean) => void;
  private onDone: (key: string, ms: number) => void;

  constructor(onBusy: (busy: boolean) => void, onDone: (key: string, ms: number) => void) {
    this.onBusy = onBusy;
    this.onDone = onDone;
  }

  enqueue<T>(pri: BrainPri, key: string, ms: number, fn: (signal: AbortSignal) => Promise<T>, waitMs = ms): Promise<T> {
    if (this.held) return Promise.reject(new Error("Helfer pausiert"));
    if (this.active?.ctrl.signal.aborted) return Promise.reject(unavailable());
    for (const job of this.pending.filter((j) => j.key === key)) {
      this.cancel(job, Object.assign(new Error("superseded"), { name: "Superseded" }));
    }
    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        pri, key, ms, fn, resolve: resolve as (value: unknown) => void, reject,
        ctrl: new AbortController(),
        timer: setTimeout(() => {
          const error = Object.assign(new Error(`Helfer-Wartezeit überschritten: ${key}`), { name: "BrainQueueTimeout" });
          this.cancel(job, error);
        }, waitMs),
      };
      this.pending.push(job);
      this.pending.sort((a, b) => a.pri - b.pri);
      this.pump();
    });
  }

  private cancel(job: Job, error: Error) {
    clearTimeout(job.timer);
    this.pending = this.pending.filter((j) => j !== job);
    if (job.ctrl.signal.aborted) return;
    job.reject(error);
    job.ctrl.abort(error);
    if (this.active === job) this.onBusy(false);
  }

  private pump() {
    if (this.active || this.held) return;
    const job = this.pending.shift();
    if (!job) {
      this.onBusy(false);
      return;
    }
    this.active = job;
    clearTimeout(job.timer);
    job.timer = setTimeout(() => {
      const error = Object.assign(new Error(`Helfer-Zeitlimit bei Ausführung: ${job.key}`), { name: "BrainExecutionTimeout" });
      this.cancel(job, error);
      this.clear(unavailable());
    }, job.ms);
    this.onBusy(true);
    const started = Date.now();
    void Promise.resolve()
      .then(() => {
        job.ctrl.signal.throwIfAborted();
        return job.fn(job.ctrl.signal);
      })
      .then((value) => {
        if (job.ctrl.signal.aborted) return;
        job.resolve(value);
        this.onDone(job.key, Date.now() - started);
      }, (error) => job.reject(error))
      .finally(() => {
        clearTimeout(job.timer);
        // An old engine may finish after reset while a new engine is running.
        if (this.active !== job) return;
        this.active = null;
        this.onBusy(false);
        this.pump();
      });
  }

  clear(error = new Error("cleared")) {
    for (const job of [...this.pending]) this.cancel(job, error);
  }

  setHold(held: boolean) {
    this.held = held;
    if (held) {
      const error = new Error("Helfer pausiert");
      this.clear(error);
      if (this.active) this.cancel(this.active, error);
    } else this.pump();
  }

  isHeld() { return this.held; }

  /** Call only after detaching the old engine; it can no longer accept work. */
  reset() {
    const error = new Error("Helfer entladen");
    this.clear(error);
    if (this.active) this.cancel(this.active, error);
    this.active = null;
    this.onBusy(false);
  }
}
