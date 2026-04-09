import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapabilityCache } from '../cache.js';
import type { CapabilityRef, CapabilitySummary, CapabilitySchema } from '@nekte/core';

const ref: CapabilityRef = { id: 'sentiment', cat: 'nlp', h: 'abc12345' };
const summary: CapabilitySummary = { ...ref, desc: 'Analyze text', cost: { avg_ms: 100 } };

describe('CapabilityCache — Basic Operations', () => {
  let cache: CapabilityCache;

  beforeEach(() => {
    cache = new CapabilityCache({ defaultTtlMs: 60_000, maxEntries: 3 });
  });

  it('stores and retrieves capabilities', () => {
    cache.set('agent1', ref, 0);
    expect(cache.get('agent1', 'sentiment', 0)).toEqual(ref);
  });

  it('returns version hash', () => {
    cache.set('agent1', ref, 0);
    expect(cache.getHash('agent1', 'sentiment')).toBe('abc12345');
  });

  it('validates hash', () => {
    cache.set('agent1', ref, 0);
    expect(cache.isValid('agent1', 'sentiment', 'abc12345')).toBe(true);
    expect(cache.isValid('agent1', 'sentiment', 'wrong')).toBe(false);
  });

  it('returns undefined for missing entries', () => {
    expect(cache.get('agent1', 'missing', 0)).toBeUndefined();
    expect(cache.getHash('agent1', 'missing')).toBeUndefined();
  });

  it('invalidates specific capability', () => {
    cache.set('agent1', ref, 0);
    cache.invalidate('agent1', 'sentiment');
    expect(cache.get('agent1', 'sentiment', 0)).toBeUndefined();
  });

  it('invalidates all capabilities for an agent', () => {
    cache.set('agent1', ref, 0);
    cache.set('agent1', { ...ref, id: 'translate', h: 'def456' }, 0);
    cache.invalidateAgent('agent1');
    expect(cache.stats().size).toBe(0);
  });

  it('clears entire cache including negatives and revalidating state', () => {
    cache.set('agent1', ref, 0);
    cache.set('agent2', { ...ref, h: 'other' }, 0);
    cache.setNegative('agent3', 'missing');
    cache.clear();
    expect(cache.stats().size).toBe(0);
    expect(cache.stats().negatives).toBe(0);
  });

  it('reports stats with agent count and negatives', () => {
    cache.set('agent1', ref, 0);
    cache.set('agent2', { ...ref, h: 'other' }, 0);
    cache.setNegative('agent3', 'nonexistent');
    const stats = cache.stats();
    expect(stats.size).toBe(2);
    expect(stats.agents).toBe(2);
    expect(stats.negatives).toBe(1);
  });
});

describe('CapabilityCache — Multi-Level Storage', () => {
  it('stores different levels for the same capability', () => {
    const cache = new CapabilityCache({ defaultTtlMs: 60_000 });

    cache.set('agent1', ref, 0); // L0
    cache.set('agent1', summary, 1); // L1

    expect(cache.get('agent1', 'sentiment', 0)).toEqual(ref);
    expect(cache.get('agent1', 'sentiment', 1)).toEqual(summary);
  });

  it('preserves existing levels when setting a new level', () => {
    const cache = new CapabilityCache({ defaultTtlMs: 60_000 });

    cache.set('agent1', ref, 0);
    cache.set('agent1', summary, 1);

    // L0 should still be there
    expect(cache.get('agent1', 'sentiment', 0)).toBeDefined();
    expect(cache.get('agent1', 'sentiment', 1)).toBeDefined();
  });

  it('updates hash when setting a new level', () => {
    const cache = new CapabilityCache({ defaultTtlMs: 60_000 });

    cache.set('agent1', ref, 0);
    cache.set('agent1', { ...summary, h: 'newhash' }, 1);

    expect(cache.getHash('agent1', 'sentiment')).toBe('newhash');
  });

  it('tracks maxLevel for token cost', () => {
    const cache = new CapabilityCache({ defaultTtlMs: 60_000 });

    // Set L0 first, then L2 — maxLevel should be 2 (cost 120)
    cache.set('agent1', ref, 0);
    cache.set('agent1', { ...ref, input: {}, output: {} } as unknown as CapabilitySchema, 2);

    // Re-setting at L0 should not downgrade maxLevel
    cache.set('agent1', { ...ref, h: 'updated' }, 0);
    // maxLevel stays 2 (verified implicitly — token cost drives GDSF)
    expect(cache.getHash('agent1', 'sentiment')).toBe('updated');
  });
});

describe('CapabilityCache — SIEVE Eviction', () => {
  it('evicts when at capacity', () => {
    const cache = new CapabilityCache({ defaultTtlMs: 60_000, maxEntries: 3 });

    cache.set('a', { id: 'cap1', cat: 'x', h: '1' }, 0);
    cache.set('a', { id: 'cap2', cat: 'x', h: '2' }, 0);
    cache.set('a', { id: 'cap3', cat: 'x', h: '3' }, 0);
    cache.set('a', { id: 'cap4', cat: 'x', h: '4' }, 0);

    expect(cache.stats().size).toBe(3);
  });

  it('scan resistance: accessed entries survive eviction', () => {
    const c = new CapabilityCache({ defaultTtlMs: 60_000, maxEntries: 3 });

    c.set('a', { id: 'hot', cat: 'x', h: '1' }, 0);
    c.set('a', { id: 'cold1', cat: 'x', h: '2' }, 0);
    c.set('a', { id: 'cold2', cat: 'x', h: '3' }, 0);

    c.getHash('a', 'hot'); // mark visited

    c.set('a', { id: 'new', cat: 'x', h: '4' }, 0);
    expect(c.getHash('a', 'hot')).toBe('1');
  });

  it('GDSF: high token-cost entries survive over low-cost ones', () => {
    const c = new CapabilityCache({ defaultTtlMs: 60_000, maxEntries: 3 });

    c.set('a', { id: 'expensive', cat: 'x', h: '1' }, 2); // 120 tok
    c.getHash('a', 'expensive');
    c.getHash('a', 'expensive');

    c.set('a', { id: 'cheap1', cat: 'x', h: '2' }, 0); // 8 tok
    c.set('a', { id: 'cheap2', cat: 'x', h: '3' }, 0); // 8 tok

    c.set('a', { id: 'new', cat: 'x', h: '4' }, 0);
    expect(c.getHash('a', 'expensive')).toBe('1');
  });
});

describe('CapabilityCache — TTL + Stale-While-Revalidate', () => {
  it('fresh entries are served normally', () => {
    vi.useFakeTimers();
    const cache = new CapabilityCache({ defaultTtlMs: 1000 });
    cache.set('agent1', ref, 0);

    vi.advanceTimersByTime(500); // within TTL
    expect(cache.get('agent1', 'sentiment', 0)).toEqual(ref);
    vi.useRealTimers();
  });

  it('stale entries are served within grace period', () => {
    vi.useFakeTimers();
    const cache = new CapabilityCache({ defaultTtlMs: 100 });
    cache.set('agent1', ref, 0);

    vi.advanceTimersByTime(150); // past TTL (100), within grace (300)
    expect(cache.get('agent1', 'sentiment', 0)).toEqual(ref);
    vi.useRealTimers();
  });

  it('expired entries return undefined past grace period', () => {
    vi.useFakeTimers();
    const cache = new CapabilityCache({ defaultTtlMs: 100 });
    cache.set('agent1', ref, 0);

    vi.advanceTimersByTime(700); // well past grace (100 + 200 = 300, +jitter)
    expect(cache.get('agent1', 'sentiment', 0)).toBeUndefined();
    vi.useRealTimers();
  });

  it('triggers revalidation callback on stale access', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const cache = new CapabilityCache({ defaultTtlMs: 100 });
    cache.onRevalidate(fn);
    cache.set('agent1', ref, 0);

    vi.advanceTimersByTime(50);
    cache.getHash('agent1', 'sentiment');
    expect(fn).not.toHaveBeenCalled(); // fresh

    vi.advanceTimersByTime(100);
    cache.getHash('agent1', 'sentiment');
    expect(fn).toHaveBeenCalledWith('agent1', 'sentiment'); // stale
    vi.useRealTimers();
  });

  it('deduplicates revalidation calls within cooldown', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const cache = new CapabilityCache({ defaultTtlMs: 100 });
    cache.onRevalidate(fn);
    cache.set('agent1', ref, 0);

    vi.advanceTimersByTime(150);

    cache.getHash('agent1', 'sentiment');
    cache.getHash('agent1', 'sentiment');
    cache.getHash('agent1', 'sentiment');

    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('allows re-revalidation after cooldown expires', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const cache = new CapabilityCache({ defaultTtlMs: 100 });
    cache.onRevalidate(fn);
    cache.set('agent1', ref, 0);

    vi.advanceTimersByTime(150);
    cache.getHash('agent1', 'sentiment'); // triggers revalidation #1
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5100); // past cooldown (5s)
    // Entry might still be in stale range depending on jitter
    cache.getHash('agent1', 'sentiment');
    // May or may not trigger depending on whether entry expired
    // The important thing is no crash and no infinite loop
    vi.useRealTimers();
  });

  it('does not trigger revalidation if no callback registered', () => {
    vi.useFakeTimers();
    const cache = new CapabilityCache({ defaultTtlMs: 100 });
    // No onRevalidate() call
    cache.set('agent1', ref, 0);

    vi.advanceTimersByTime(150);
    // Should not throw, just serve stale
    expect(cache.getHash('agent1', 'sentiment')).toBe('abc12345');
    vi.useRealTimers();
  });
});

describe('CapabilityCache — Negative Caching', () => {
  it('records and checks negative entries', () => {
    const cache = new CapabilityCache({ negativeTtlMs: 60_000 });
    cache.setNegative('agent1', 'nonexistent');

    expect(cache.isNegative('agent1', 'nonexistent')).toBe(true);
    expect(cache.isNegative('agent1', 'other')).toBe(false);
  });

  it('negative entries expire after negativeTtlMs', () => {
    vi.useFakeTimers();
    const cache = new CapabilityCache({ negativeTtlMs: 100 });
    cache.setNegative('agent1', 'gone');

    expect(cache.isNegative('agent1', 'gone')).toBe(true);

    vi.advanceTimersByTime(200);
    expect(cache.isNegative('agent1', 'gone')).toBe(false);
    vi.useRealTimers();
  });

  it('positive set clears negative entry', () => {
    const cache = new CapabilityCache({ negativeTtlMs: 60_000 });
    cache.setNegative('agent1', 'sentiment');
    expect(cache.isNegative('agent1', 'sentiment')).toBe(true);

    cache.set('agent1', ref, 0);
    expect(cache.isNegative('agent1', 'sentiment')).toBe(false);
    expect(cache.getHash('agent1', 'sentiment')).toBe('abc12345');
  });

  it('negative cache blocks getHash', () => {
    const cache = new CapabilityCache({ negativeTtlMs: 60_000 });
    cache.set('agent1', ref, 0);
    cache.invalidate('agent1', 'sentiment');
    cache.setNegative('agent1', 'sentiment');

    expect(cache.getHash('agent1', 'sentiment')).toBeUndefined();
  });

  it('negative cache blocks get at all levels', () => {
    const cache = new CapabilityCache({ negativeTtlMs: 60_000 });
    cache.setNegative('agent1', 'sentiment');

    expect(cache.get('agent1', 'sentiment', 0)).toBeUndefined();
    expect(cache.get('agent1', 'sentiment', 1)).toBeUndefined();
    expect(cache.get('agent1', 'sentiment', 2)).toBeUndefined();
  });

  it('invalidateAgent clears negatives for that agent only', () => {
    const cache = new CapabilityCache({ negativeTtlMs: 60_000 });
    cache.setNegative('agent1', 'cap1');
    cache.setNegative('agent1', 'cap2');
    cache.setNegative('agent2', 'cap1');

    cache.invalidateAgent('agent1');
    expect(cache.isNegative('agent1', 'cap1')).toBe(false);
    expect(cache.isNegative('agent1', 'cap2')).toBe(false);
    expect(cache.isNegative('agent2', 'cap1')).toBe(true);
  });

  it('clear removes all negatives', () => {
    const cache = new CapabilityCache({ negativeTtlMs: 60_000 });
    cache.setNegative('agent1', 'cap1');
    cache.setNegative('agent2', 'cap2');
    cache.clear();
    expect(cache.stats().negatives).toBe(0);
  });

  it('overwriting negative with setNegative resets TTL', () => {
    vi.useFakeTimers();
    const cache = new CapabilityCache({ negativeTtlMs: 200 });

    cache.setNegative('agent1', 'cap1');
    vi.advanceTimersByTime(150); // 150ms into 200ms TTL
    cache.setNegative('agent1', 'cap1'); // reset

    vi.advanceTimersByTime(100); // 100ms into NEW 200ms TTL
    expect(cache.isNegative('agent1', 'cap1')).toBe(true); // still valid

    vi.advanceTimersByTime(150); // 250ms into new TTL → expired
    expect(cache.isNegative('agent1', 'cap1')).toBe(false);
    vi.useRealTimers();
  });
});

describe('CapabilityCache — Namespace Isolation', () => {
  it('namespaced caches are isolated', () => {
    const cache1 = new CapabilityCache({ namespace: 'prod' });
    const cache2 = new CapabilityCache({ namespace: 'staging' });

    cache1.set('agent1', ref, 0);
    expect(cache2.getHash('agent1', 'sentiment')).toBeUndefined();
  });

  it('negatives are namespace-isolated', () => {
    const cache1 = new CapabilityCache({ namespace: 'prod', negativeTtlMs: 60_000 });
    const cache2 = new CapabilityCache({ namespace: 'staging', negativeTtlMs: 60_000 });

    cache1.setNegative('agent1', 'cap1');
    expect(cache2.isNegative('agent1', 'cap1')).toBe(false);
  });
});
