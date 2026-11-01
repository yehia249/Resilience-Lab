export type BreakerState = 'closed' | 'open' | 'half-open';
export class CircuitOpenError extends Error {
  constructor() {
    super('Payment circuit is open');
  }
}
export interface BreakerOptions {
  window: number;
  minimum: number;
  threshold: number;
  openMs: number;
  probes: number;
  requiredSuccesses: number;
}
export const breakerDefaults: BreakerOptions = {
  window: 20,
  minimum: 10,
  threshold: 0.5,
  openMs: 10000,
  probes: 3,
  requiredSuccesses: 2,
};
export class CircuitBreaker {
  state: BreakerState = 'closed';
  private outcomes: boolean[] = [];
  private openedAt = 0;
  private inFlight = 0;
  private completed = 0;
  private successes = 0;
  private generation = 0;
  constructor(
    private options: BreakerOptions = breakerDefaults,
    private now = Date.now,
    private onChange: (state: BreakerState) => void = () => {},
  ) {}
  private transition(state: BreakerState) {
    this.state = state;
    this.generation++;
    this.inFlight = 0;
    this.completed = 0;
    this.successes = 0;
    if (state === 'open') this.openedAt = this.now();
    if (state === 'closed') this.outcomes = [];
    this.onChange(state);
  }
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (this.now() - this.openedAt < this.options.openMs) throw new CircuitOpenError();
      this.transition('half-open');
    }
    const probe = this.state === 'half-open';
    if (probe && this.inFlight + this.completed >= this.options.probes)
      throw new CircuitOpenError();
    const epoch = this.generation;
    if (probe) this.inFlight++;
    try {
      const result = await fn();
      this.record(true, probe, epoch);
      return result;
    } catch (error) {
      this.record(false, probe, epoch);
      throw error;
    }
  }
  private record(ok: boolean, probe: boolean, epoch: number) {
    if (epoch !== this.generation) return;
    if (probe) {
      this.inFlight--;
      this.completed++;
      if (ok) this.successes++;
      if (this.successes >= this.options.requiredSuccesses) this.transition('closed');
      else if (
        this.completed === this.options.probes ||
        this.completed - this.successes > this.options.probes - this.options.requiredSuccesses
      )
        this.transition('open');
      return;
    }
    this.outcomes.push(ok);
    if (this.outcomes.length > this.options.window) this.outcomes.shift();
    if (
      this.outcomes.length >= this.options.minimum &&
      this.outcomes.filter((v) => !v).length / this.outcomes.length >= this.options.threshold
    )
      this.transition('open');
  }
}
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  options: {
    retries: number;
    baseMs?: number;
    random?: () => number;
    wait?: (ms: number) => Promise<void>;
    retryable?: (error: unknown) => boolean;
  },
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt + 1);
    } catch (error) {
      if (attempt >= options.retries || options.retryable?.(error) === false) throw error;
      await (options.wait ?? sleep)(
        (options.random ?? Math.random)() * (options.baseMs ?? 100) * 2 ** attempt,
      );
    }
  }
}
export class Bulkhead {
  private active = 0;
  constructor(private limit = 50) {}
  async run<T>(fn: () => Promise<T>) {
    if (this.active >= this.limit) throw new Error('Bulkhead full');
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
    }
  }
}
export class RecoveryDetector {
  private streak = 0;
  observe(error: number | null, p95: number | null, ready: boolean) {
    this.streak =
      error !== null && p95 !== null && error < 2 && p95 < 250 && ready ? this.streak + 1 : 0;
    return this.streak >= 10;
  }
  reset() {
    this.streak = 0;
  }
}
