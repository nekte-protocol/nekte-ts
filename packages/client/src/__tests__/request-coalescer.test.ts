import { describe, it, expect, vi } from 'vitest';
import { RequestCoalescer } from '../request-coalescer.js';

describe('RequestCoalescer', () => {
  // -----------------------------------------------------------------
  // Basic behavior
  // -----------------------------------------------------------------

  it('executes the function for a new key', async () => {
    const coalescer = new RequestCoalescer();
    const fn = vi.fn().mockResolvedValue('result');

    const result = await coalescer.coalesce('key1', fn);
    expect(result).toBe('result');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns the result of the function', async () => {
    const coalescer = new RequestCoalescer();
    const result = await coalescer.coalesce('k', async () => ({ data: 42 }));
    expect(result).toEqual({ data: 42 });
  });

  // -----------------------------------------------------------------
  // Coalescing (thundering herd prevention)
  // -----------------------------------------------------------------

  it('coalesces concurrent requests for the same key', async () => {
    const coalescer = new RequestCoalescer();
    let resolvePromise!: (value: string) => void;
    const fn = vi.fn().mockReturnValue(
      new Promise<string>((resolve) => {
        resolvePromise = resolve;
      }),
    );

    const p1 = coalescer.coalesce('key1', fn);
    const p2 = coalescer.coalesce('key1', fn);
    const p3 = coalescer.coalesce('key1', fn);

    expect(coalescer.pending).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);

    resolvePromise('shared-result');

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toBe('shared-result');
    expect(r2).toBe('shared-result');
    expect(r3).toBe('shared-result');
    expect(coalescer.pending).toBe(0);
  });

  it('coalesced requests resolve to the same value', async () => {
    const coalescer = new RequestCoalescer();
    let resolvePromise!: (v: string) => void;
    const fn = vi.fn().mockReturnValue(
      new Promise<string>((resolve) => {
        resolvePromise = resolve;
      }),
    );

    const p1 = coalescer.coalesce('key1', fn);
    const p2 = coalescer.coalesce('key1', fn);

    resolvePromise('shared');
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe('shared');
    expect(r2).toBe('shared');
    // Only 1 actual execution
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------
  // Sequential requests (after completion)
  // -----------------------------------------------------------------

  it('allows new request after previous completes', async () => {
    const coalescer = new RequestCoalescer();
    let callCount = 0;
    const fn = () => Promise.resolve(`result-${++callCount}`);

    const r1 = await coalescer.coalesce('key1', fn);
    expect(r1).toBe('result-1');

    const r2 = await coalescer.coalesce('key1', fn);
    expect(r2).toBe('result-2');
  });

  // -----------------------------------------------------------------
  // Key isolation
  // -----------------------------------------------------------------

  it('different keys execute independently', async () => {
    const coalescer = new RequestCoalescer();
    const fn1 = vi.fn().mockResolvedValue('a');
    const fn2 = vi.fn().mockResolvedValue('b');

    const [r1, r2] = await Promise.all([
      coalescer.coalesce('key1', fn1),
      coalescer.coalesce('key2', fn2),
    ]);

    expect(r1).toBe('a');
    expect(r2).toBe('b');
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
    expect(coalescer.pending).toBe(0);
  });

  // -----------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------

  it('cleans up after rejection', async () => {
    const coalescer = new RequestCoalescer();
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(coalescer.coalesce('key1', fn)).rejects.toThrow('fail');
    expect(coalescer.pending).toBe(0);
  });

  it('allows retry after failure', async () => {
    const coalescer = new RequestCoalescer();
    const failing = vi.fn().mockRejectedValue(new Error('fail'));
    const succeeding = vi.fn().mockResolvedValue('recovered');

    await expect(coalescer.coalesce('key1', failing)).rejects.toThrow('fail');

    const result = await coalescer.coalesce('key1', succeeding);
    expect(result).toBe('recovered');
  });

  it('coalesced requests all reject if the original rejects', async () => {
    const coalescer = new RequestCoalescer();
    let rejectPromise!: (err: Error) => void;
    const fn = vi.fn().mockReturnValue(
      new Promise<string>((_, reject) => {
        rejectPromise = reject;
      }),
    );

    const p1 = coalescer.coalesce('key1', fn);
    const p2 = coalescer.coalesce('key1', fn);
    const p3 = coalescer.coalesce('key1', fn);

    rejectPromise(new Error('boom'));

    await expect(p1).rejects.toThrow('boom');
    await expect(p2).rejects.toThrow('boom');
    await expect(p3).rejects.toThrow('boom');
    expect(coalescer.pending).toBe(0);
  });

  // -----------------------------------------------------------------
  // pending counter
  // -----------------------------------------------------------------

  it('tracks pending count accurately', async () => {
    const coalescer = new RequestCoalescer();
    const resolvers: Array<() => void> = [];

    for (let i = 0; i < 5; i++) {
      coalescer.coalesce(
        `key-${i}`,
        () =>
          new Promise<void>((resolve) => {
            resolvers.push(resolve);
          }),
      );
    }

    expect(coalescer.pending).toBe(5);

    resolvers[0]();
    resolvers[1]();
    await new Promise((r) => setTimeout(r, 0)); // flush microtasks
    expect(coalescer.pending).toBe(3);

    resolvers[2]();
    resolvers[3]();
    resolvers[4]();
    await new Promise((r) => setTimeout(r, 0));
    expect(coalescer.pending).toBe(0);
  });

  // -----------------------------------------------------------------
  // Type safety
  // -----------------------------------------------------------------

  it('preserves return type through generics', async () => {
    const coalescer = new RequestCoalescer();

    const num = await coalescer.coalesce('k1', async () => 42);
    const str = await coalescer.coalesce('k2', async () => 'hello');
    const obj = await coalescer.coalesce('k3', async () => ({ x: 1 }));

    expect(typeof num).toBe('number');
    expect(typeof str).toBe('string');
    expect(typeof obj).toBe('object');
  });
});
