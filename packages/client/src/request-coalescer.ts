/**
 * Request Coalescer — Infrastructure Service
 *
 * Prevents thundering herd / cache stampede by deduplicating
 * concurrent requests for the same key. If a refresh is in-flight
 * for key K, subsequent callers wait for the same Promise instead
 * of launching duplicate network requests.
 *
 * @example
 * ```ts
 * const coalescer = new RequestCoalescer();
 *
 * // These 3 concurrent calls produce only 1 actual fetch:
 * const [r1, r2, r3] = await Promise.all([
 *   coalescer.coalesce('key', () => fetch('/api/data')),
 *   coalescer.coalesce('key', () => fetch('/api/data')),
 *   coalescer.coalesce('key', () => fetch('/api/data')),
 * ]);
 * // r1 === r2 === r3 (same resolved value)
 * ```
 */

export class RequestCoalescer {
  private inflight = new Map<string, Promise<unknown>>();

  /**
   * Execute `fn` for `key`, or join an in-flight request if one exists.
   * The Promise is removed from the map once resolved (success or failure).
   */
  async coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = fn().finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return promise;
  }

  /** Number of in-flight requests */
  get pending(): number {
    return this.inflight.size;
  }
}
