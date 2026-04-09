import { describe, it, expect, vi } from 'vitest';
import { SharedInMemoryCache } from '../shared-cache.js';
import { CapabilityCache } from '../cache.js';
import type { CapabilityRef } from '@nekte/core';

const ref: CapabilityRef = { id: 'sentiment', cat: 'nlp', h: 'abc12345' };

describe('SharedInMemoryCache', () => {
  it('allows two caches to share a store', () => {
    const shared = new SharedInMemoryCache({ maxEntries: 100 });

    const cache1 = new CapabilityCache({ store: shared.store() });
    const cache2 = new CapabilityCache({ store: shared.store() });

    // Cache 1 writes
    cache1.set('agent-b', ref, 0);

    // Cache 2 reads
    expect(cache2.getHash('agent-b', 'sentiment')).toBe('abc12345');
    expect(cache2.get('agent-b', 'sentiment', 0)).toEqual(ref);
  });

  it('tracks size across both caches', () => {
    const shared = new SharedInMemoryCache({ maxEntries: 100 });
    const cache1 = new CapabilityCache({ store: shared.store() });
    const cache2 = new CapabilityCache({ store: shared.store() });

    cache1.set('agent-a', ref, 0);
    cache2.set('agent-b', { ...ref, h: 'other' }, 0);

    expect(shared.size).toBe(2);
  });

  it('invalidation in one cache affects the other', () => {
    const shared = new SharedInMemoryCache({ maxEntries: 100 });
    const cache1 = new CapabilityCache({ store: shared.store() });
    const cache2 = new CapabilityCache({ store: shared.store() });

    cache1.set('agent-b', ref, 0);
    expect(cache2.getHash('agent-b', 'sentiment')).toBe('abc12345');

    cache1.invalidate('agent-b', 'sentiment');
    expect(cache2.getHash('agent-b', 'sentiment')).toBeUndefined();
  });

  it('fires invalidation callbacks', () => {
    const shared = new SharedInMemoryCache();
    const callback = vi.fn();

    const unsub = shared.onInvalidate(callback);
    shared.notifyInvalidation('agent-b:sentiment');
    expect(callback).toHaveBeenCalledWith('agent-b:sentiment');

    unsub();
    shared.notifyInvalidation('agent-b:other');
    expect(callback).toHaveBeenCalledTimes(1); // not called again after unsub
  });

  it('supports namespace isolation', () => {
    const shared = new SharedInMemoryCache({ maxEntries: 100 });

    const cacheStaging = new CapabilityCache({ store: shared.store(), namespace: 'staging' });
    const cacheProd = new CapabilityCache({ store: shared.store(), namespace: 'prod' });

    cacheStaging.set('agent-b', ref, 0);

    // Same agent+cap but different namespace — should not find it
    expect(cacheProd.getHash('agent-b', 'sentiment')).toBeUndefined();

    // Same namespace — should find it
    expect(cacheStaging.getHash('agent-b', 'sentiment')).toBe('abc12345');
  });

  it('clear wipes the shared store', () => {
    const shared = new SharedInMemoryCache({ maxEntries: 100 });
    const cache1 = new CapabilityCache({ store: shared.store() });

    cache1.set('agent-a', ref, 0);
    cache1.set('agent-b', { ...ref, h: 'other' }, 0);
    expect(shared.size).toBe(2);

    shared.clear();
    expect(shared.size).toBe(0);
  });
});
