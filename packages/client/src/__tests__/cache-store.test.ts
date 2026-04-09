import { describe, it, expect, vi } from 'vitest';
import { InMemoryCacheStore, type CacheStoreEntry } from '../cache-store.js';

function makeEntry(overrides?: Partial<CacheStoreEntry>): CacheStoreEntry {
  return {
    data: { test: true },
    cachedAt: Date.now(),
    ttlMs: 60_000,
    accessCount: 0,
    tokenCost: 8,
    ...overrides,
  };
}

describe('InMemoryCacheStore', () => {
  // -----------------------------------------------------------------
  // Basic CRUD
  // -----------------------------------------------------------------

  it('stores and retrieves an entry', () => {
    const store = new InMemoryCacheStore();
    store.set('key1', makeEntry());
    const result = store.get('key1');
    expect(result).toBeDefined();
    expect(result!.freshness).toBe('fresh');
    expect(result!.entry.data).toEqual({ test: true });
  });

  it('returns undefined for missing key', () => {
    const store = new InMemoryCacheStore();
    expect(store.get('missing')).toBeUndefined();
  });

  it('deletes an entry', () => {
    const store = new InMemoryCacheStore();
    store.set('key1', makeEntry());
    expect(store.delete('key1')).toBe(true);
    expect(store.get('key1')).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('delete returns false for missing key', () => {
    const store = new InMemoryCacheStore();
    expect(store.delete('missing')).toBe(false);
  });

  it('clear removes all entries', () => {
    const store = new InMemoryCacheStore();
    store.set('a', makeEntry());
    store.set('b', makeEntry());
    store.clear();
    expect(store.size).toBe(0);
  });

  it('keys() iterates all stored keys', () => {
    const store = new InMemoryCacheStore();
    store.set('a', makeEntry());
    store.set('b', makeEntry());
    store.set('c', makeEntry());
    expect([...store.keys()]).toEqual(['a', 'b', 'c']);
  });

  // -----------------------------------------------------------------
  // TTL + Freshness states
  // -----------------------------------------------------------------

  it('fresh entry within TTL', () => {
    const store = new InMemoryCacheStore({ jitterFactor: 0 });
    store.set('key', makeEntry({ ttlMs: 1000 }));
    const result = store.get('key');
    expect(result!.freshness).toBe('fresh');
  });

  it('stale entry: past TTL but within grace period', () => {
    vi.useFakeTimers();
    const store = new InMemoryCacheStore({ jitterFactor: 0, graceFactor: 2 });
    store.set('key', makeEntry({ ttlMs: 100, cachedAt: Date.now() }));

    vi.advanceTimersByTime(150); // past 100ms TTL, within 300ms grace
    const result = store.get('key');
    expect(result).toBeDefined();
    expect(result!.freshness).toBe('stale');
    vi.useRealTimers();
  });

  it('expired entry: past grace period returns undefined', () => {
    vi.useFakeTimers();
    const store = new InMemoryCacheStore({ jitterFactor: 0, graceFactor: 2 });
    store.set('key', makeEntry({ ttlMs: 100, cachedAt: Date.now() }));

    vi.advanceTimersByTime(400); // past 300ms grace (100 + 2*100)
    expect(store.get('key')).toBeUndefined();
    expect(store.size).toBe(0); // cleaned up
    vi.useRealTimers();
  });

  it('graceFactor: 0 disables stale-while-revalidate', () => {
    vi.useFakeTimers();
    const store = new InMemoryCacheStore({ jitterFactor: 0, graceFactor: 0 });
    store.set('key', makeEntry({ ttlMs: 100, cachedAt: Date.now() }));

    vi.advanceTimersByTime(101);
    expect(store.get('key')).toBeUndefined(); // no grace, immediately expired
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------
  // TTL Jitter
  // -----------------------------------------------------------------

  it('applies TTL jitter (does not mutate original entry)', () => {
    const store = new InMemoryCacheStore({ jitterFactor: 0.5 });
    const entry = makeEntry({ ttlMs: 1000 });
    store.set('key', entry);

    // Original entry TTL should be unchanged
    expect(entry.ttlMs).toBe(1000);

    // Stored TTL should be jittered (±50%)
    const result = store.get('key')!;
    expect(result.entry.ttlMs).toBeGreaterThanOrEqual(500);
    expect(result.entry.ttlMs).toBeLessThanOrEqual(1500);
  });

  it('jitter produces different TTLs for bulk inserts', () => {
    const store = new InMemoryCacheStore({ jitterFactor: 0.1, maxEntries: 100 });
    const ttls = new Set<number>();

    for (let i = 0; i < 50; i++) {
      store.set(`key-${i}`, makeEntry({ ttlMs: 10_000 }));
      const result = store.get(`key-${i}`)!;
      ttls.add(result.entry.ttlMs);
    }

    // With 50 entries and 10% jitter, we should get multiple distinct TTLs
    expect(ttls.size).toBeGreaterThan(1);
  });

  it('jitterFactor: 0 produces exact TTL', () => {
    const store = new InMemoryCacheStore({ jitterFactor: 0 });
    store.set('key', makeEntry({ ttlMs: 5000 }));
    expect(store.get('key')!.entry.ttlMs).toBe(5000);
  });

  // -----------------------------------------------------------------
  // accessCount tracking
  // -----------------------------------------------------------------

  it('increments accessCount on each get()', () => {
    const store = new InMemoryCacheStore({ jitterFactor: 0 });
    store.set('key', makeEntry({ accessCount: 0 }));

    store.get('key');
    store.get('key');
    store.get('key');

    expect(store.get('key')!.entry.accessCount).toBe(4); // 3 previous + this get
  });

  it('does not increment accessCount for expired entries', () => {
    vi.useFakeTimers();
    const store = new InMemoryCacheStore({ jitterFactor: 0, graceFactor: 0 });
    store.set('key', makeEntry({ ttlMs: 100, cachedAt: Date.now(), accessCount: 5 }));

    vi.advanceTimersByTime(200);
    expect(store.get('key')).toBeUndefined(); // expired, not incremented
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------
  // SIEVE eviction (scan resistance)
  // -----------------------------------------------------------------

  it('evicts when at capacity', () => {
    const store = new InMemoryCacheStore({ maxEntries: 3, jitterFactor: 0 });
    store.set('a', makeEntry());
    store.set('b', makeEntry());
    store.set('c', makeEntry());
    store.set('d', makeEntry()); // triggers eviction

    expect(store.size).toBe(3);
  });

  it('SIEVE: accessed entries survive over unaccessed', () => {
    const store = new InMemoryCacheStore({ maxEntries: 3, jitterFactor: 0 });
    store.set('hot', makeEntry());
    store.set('cold1', makeEntry());
    store.set('cold2', makeEntry());

    store.get('hot'); // marks visited in SIEVE

    store.set('new', makeEntry()); // evicts a cold entry
    expect(store.get('hot')).toBeDefined();
  });

  it('SIEVE: bulk scan inserts are evicted first', () => {
    const store = new InMemoryCacheStore({ maxEntries: 5, jitterFactor: 0 });

    // Hot entries
    store.set('hot1', makeEntry());
    store.set('hot2', makeEntry());
    store.get('hot1');
    store.get('hot2');

    // Fill remaining capacity
    store.set('scan1', makeEntry());
    store.set('scan2', makeEntry());
    store.set('scan3', makeEntry());

    // Overflow → evict scan entries
    store.set('new1', makeEntry());
    store.set('new2', makeEntry());

    expect(store.get('hot1')).toBeDefined();
    expect(store.get('hot2')).toBeDefined();
  });

  // -----------------------------------------------------------------
  // GDSF: token-cost-weighted eviction
  // -----------------------------------------------------------------

  it('GDSF: prefers evicting low token-cost entries', () => {
    const store = new InMemoryCacheStore({ maxEntries: 3, jitterFactor: 0 });

    // High cost, accessed multiple times
    const expensive = makeEntry({ tokenCost: 120, accessCount: 5 });
    store.set('expensive', expensive);
    store.get('expensive'); // access to register in SIEVE + increment count

    // Low cost, never accessed
    store.set('cheap1', makeEntry({ tokenCost: 8, accessCount: 0 }));
    store.set('cheap2', makeEntry({ tokenCost: 8, accessCount: 0 }));

    // Overflow → GDSF should prefer evicting cheap entries (priority = 0×8 = 0)
    // over expensive (priority = 6×120 = 720)
    store.set('new', makeEntry({ tokenCost: 8, accessCount: 0 }));

    expect(store.get('expensive')).toBeDefined();
  });

  it('GDSF: equal token-cost falls back to SIEVE ordering', () => {
    const store = new InMemoryCacheStore({ maxEntries: 3, jitterFactor: 0 });

    store.set('a', makeEntry({ tokenCost: 40, accessCount: 0 }));
    store.set('b', makeEntry({ tokenCost: 40, accessCount: 0 }));
    store.set('c', makeEntry({ tokenCost: 40, accessCount: 0 }));

    // All same priority → SIEVE FIFO order determines eviction
    store.set('d', makeEntry({ tokenCost: 40, accessCount: 0 }));
    expect(store.size).toBe(3);
  });

  // -----------------------------------------------------------------
  // Update existing entry
  // -----------------------------------------------------------------

  it('updating an existing key preserves slot without eviction', () => {
    const store = new InMemoryCacheStore({ maxEntries: 3, jitterFactor: 0 });
    store.set('a', makeEntry({ data: 'v1' }));
    store.set('b', makeEntry());
    store.set('c', makeEntry());

    // Update 'a' — should NOT evict anything
    store.set('a', makeEntry({ data: 'v2' }));
    expect(store.size).toBe(3);
    expect(store.get('a')!.entry.data).toBe('v2');
  });

  // -----------------------------------------------------------------
  // Edge: capacity 1
  // -----------------------------------------------------------------

  it('handles capacity of 1', () => {
    const store = new InMemoryCacheStore({ maxEntries: 1, jitterFactor: 0 });
    store.set('a', makeEntry({ data: 'first' }));
    expect(store.get('a')!.entry.data).toBe('first');

    store.set('b', makeEntry({ data: 'second' }));
    expect(store.size).toBe(1);
    expect(store.get('a')).toBeUndefined();
    expect(store.get('b')!.entry.data).toBe('second');
  });
});
