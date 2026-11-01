import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker, CircuitOpenError, Bulkhead, retry, RecoveryDetector } from './resilience';
import { FaultRequest, Cart, CheckoutResponse, Snapshot, StreamEvent } from './schemas';
describe('circuit breaker', () => {
  it('opens at 50% with ten calls, rejects, then closes after two probes', async () => {
    let clock = 0;
    const change = vi.fn();
    const b = new CircuitBreaker(undefined, () => clock, change);
    for (let i = 0; i < 5; i++) await b.execute(async () => 1);
    for (let i = 0; i < 5; i++)
      await expect(
        b.execute(async () => {
          throw Error('down');
        }),
      ).rejects.toThrow();
    expect(b.state).toBe('open');
    await expect(b.execute(async () => 1)).rejects.toBeInstanceOf(CircuitOpenError);
    clock = 10000;
    await b.execute(async () => 1);
    expect(b.state).toBe('half-open');
    await b.execute(async () => 1);
    expect(b.state).toBe('closed');
    expect(change.mock.calls.flat()).toEqual(['open', 'half-open', 'closed']);
  });
  it('limits concurrent probes and reopens after failures', async () => {
    let clock = 0;
    const b = new CircuitBreaker(
      { window: 2, minimum: 2, threshold: 0.5, openMs: 10, probes: 3, requiredSuccesses: 2 },
      () => clock,
    );
    for (let i = 0; i < 2; i++)
      await b
        .execute(async () => {
          throw Error();
        })
        .catch(() => {});
    clock = 10;
    let release!: () => void;
    const pending = () => new Promise<void>((r) => (release = r));
    const p = b.execute(pending);
    await b
      .execute(async () => {
        throw Error();
      })
      .catch(() => {});
    await b
      .execute(async () => {
        throw Error();
      })
      .catch(() => {});
    expect(b.state).toBe('open');
    release();
    await p;
    expect(b.state).toBe('open');
  });
  it('does not open before minimum sample count', async () => {
    const b = new CircuitBreaker();
    for (let i = 0; i < 9; i++)
      await b
        .execute(async () => {
          throw Error();
        })
        .catch(() => {});
    expect(b.state).toBe('closed');
  });
});
describe('retry', () => {
  it('uses bounded exponential full jitter and stops at retry budget', async () => {
    const waits: number[] = [];
    let count = 0;
    await expect(
      retry(
        async () => {
          count++;
          throw Error('x');
        },
        {
          retries: 2,
          random: () => 0.5,
          wait: async (ms) => {
            waits.push(ms);
          },
        },
      ),
    ).rejects.toThrow('x');
    expect(count).toBe(3);
    expect(waits).toEqual([50, 100]);
  });
  it('does not retry permanent failures', async () => {
    const fn = vi.fn(async () => {
      throw Error();
    });
    await retry(fn, { retries: 2, retryable: () => false }).catch(() => {});
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
describe('bulkhead', () => {
  it('fails fast and releases slots after success and failure', async () => {
    const b = new Bulkhead(1);
    let resolve!: () => void;
    const p = b.run(() => new Promise<void>((r) => (resolve = r)));
    await expect(b.run(async () => 1)).rejects.toThrow('Bulkhead full');
    resolve();
    await p;
    await b
      .run(async () => {
        throw Error();
      })
      .catch(() => {});
    expect(await b.run(async () => 42)).toBe(42);
  });
});
describe('recovery', () => {
  it('requires ten consecutive healthy samples, valid metrics and ready replicas', () => {
    const r = new RecoveryDetector();
    for (let i = 0; i < 9; i++) expect(r.observe(0, 100, true)).toBe(false);
    expect(r.observe(null, 100, true)).toBe(false);
    for (let i = 0; i < 9; i++) expect(r.observe(0, 100, true)).toBe(false);
    expect(r.observe(0, 100, true)).toBe(true);
    expect(r.observe(0, 250, true)).toBe(false);
    expect(r.observe(2, 100, true)).toBe(false);
    expect(r.observe(0, 100, false)).toBe(false);
  });
});
describe('schema contracts', () => {
  it('rejects arbitrary fault payloads, invalid cart sizes and checkout statuses', () => {
    expect(FaultRequest.safeParse({ type: 'EXEC', command: 'rm' }).success).toBe(false);
    expect(FaultRequest.safeParse({ type: 'KILL_PAYMENT', extra: true }).success).toBe(false);
    expect(Cart.safeParse({ items: [{ productId: 'x', quantity: -1 }] }).success).toBe(false);
    expect(CheckoutResponse.safeParse({ status: 'ok' }).success).toBe(false);
  });
  it('requires live provenance and the complete snapshot shape', () => {
    expect(Snapshot.safeParse({ source: 'simulated' }).success).toBe(false);
    expect(
      StreamEvent.safeParse({
        type: 'metrics',
        data: { rps: null, errorRatePct: null, p50: null, p95: null, p99: null },
      }).success,
    ).toBe(true);
  });
});
