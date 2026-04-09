/**
 * Cache Store — Port + Default Adapter (Hexagonal Architecture)
 *
 * The CacheStore port decouples CapabilityCache from its backing storage.
 * This enables shared caches, Redis-backed caches, etc.
 *
 * The default InMemoryCacheStore uses:
 *   - SIEVE eviction (NSDI 2024) for scan resistance
 *   - GDSF token-cost weighting for intelligent eviction
 *   - TTL jitter to prevent cache stampedes
 *   - O(1) eviction via SIEVE hand pointer
 */

import { SievePolicy } from '@nekte/core';

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

/** Entry stored in the cache */
export interface CacheStoreEntry {
  data: unknown;
  cachedAt: number;
  ttlMs: number;
  /** Number of times this entry has been accessed (for GDSF weighting) */
  accessCount: number;
  /** Token cost to re-fetch this entry (for GDSF weighting) */
  tokenCost: number;
}

/** Result of a cache lookup, including freshness state */
export interface CacheGetResult {
  entry: CacheStoreEntry;
  /** 'fresh' = within TTL, 'stale' = past TTL but within grace, 'expired' = past grace */
  freshness: 'fresh' | 'stale';
}

/**
 * Port: backing store for cache entries.
 * Implement this to use Redis, shared memory, etc.
 */
export interface CacheStore {
  /**
   * Get an entry. Returns undefined if not found or fully expired.
   * Returns { entry, freshness } where freshness indicates TTL state.
   */
  get(key: string): CacheGetResult | undefined;
  set(key: string, entry: CacheStoreEntry): void;
  delete(key: string): boolean;
  keys(): IterableIterator<string>;
  readonly size: number;
  clear(): void;
}

// ---------------------------------------------------------------------------
// Default Adapter: In-Memory with SIEVE + GDSF
// ---------------------------------------------------------------------------

export interface InMemoryStoreConfig {
  maxEntries?: number;
  /** TTL jitter factor (0-1). Default: 0.1 (+/-10%) */
  jitterFactor?: number;
  /**
   * Grace period multiplier for stale-while-revalidate.
   * Entries stay accessible for (TTL x graceFactor) after TTL expires.
   * Default: 2 (entries live 3x their TTL total: 1x fresh + 2x stale)
   */
  graceFactor?: number;
}

/**
 * Default adapter: SIEVE + GDSF eviction, TTL jitter, stale-while-revalidate.
 */
export class InMemoryCacheStore implements CacheStore {
  private entries = new Map<string, CacheStoreEntry>();
  private readonly sieve = new SievePolicy<string>();
  private readonly maxEntries: number;
  private readonly jitterFactor: number;
  private readonly graceFactor: number;

  constructor(config?: InMemoryStoreConfig) {
    this.maxEntries = config?.maxEntries ?? 1000;
    this.jitterFactor = config?.jitterFactor ?? 0.1;
    this.graceFactor = config?.graceFactor ?? 2;
  }

  get(key: string): CacheGetResult | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    const age = Date.now() - entry.cachedAt;
    const ttl = entry.ttlMs;
    const graceLimit = ttl + ttl * this.graceFactor;

    if (age <= ttl) {
      // Fresh — within TTL
      entry.accessCount++;
      this.sieve.access(key);
      return { entry, freshness: 'fresh' };
    }

    if (age <= graceLimit) {
      // Stale — past TTL but within grace period (serve + trigger revalidation)
      entry.accessCount++;
      this.sieve.access(key);
      return { entry, freshness: 'stale' };
    }

    // Expired — past grace period, remove
    this.entries.delete(key);
    this.sieve.delete(key);
    return undefined;
  }

  set(key: string, entry: CacheStoreEntry): void {
    // Clone + apply TTL jitter to prevent stampede (don't mutate caller's object)
    const stored: CacheStoreEntry = {
      ...entry,
      ttlMs: this.applyJitter(entry.ttlMs),
    };

    // Update existing
    if (this.entries.has(key)) {
      this.entries.set(key, stored);
      this.sieve.access(key);
      return;
    }

    // Evict if at capacity
    while (this.entries.size >= this.maxEntries) {
      this.evict();
    }

    this.entries.set(key, stored);
    this.sieve.insert(key);
  }

  delete(key: string): boolean {
    this.sieve.delete(key);
    return this.entries.delete(key);
  }

  keys(): IterableIterator<string> {
    return this.entries.keys();
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.sieve.clear();
  }

  /**
   * GDSF-weighted SIEVE eviction.
   *
   * SIEVE selects the candidate (scan-resistant, O(1) amortized).
   * Before confirming the eviction, we check if the candidate has a high
   * GDSF priority (accessCount × tokenCost). If so, we give it one more
   * chance and try the next SIEVE candidate instead.
   *
   * This prevents evicting an L2 schema invoked 10 times (priority=1200)
   * when an L0 entry invoked once (priority=8) is also available.
   */
  private evict(): void {
    // Try up to 3 SIEVE candidates, pick the one with lowest GDSF priority
    let bestKey: string | undefined;
    let bestPriority = Infinity;
    const candidates: string[] = [];

    for (let i = 0; i < 3; i++) {
      const key = this.sieve.evict();
      if (!key) break;
      candidates.push(key);

      const entry = this.entries.get(key);
      const priority = entry ? entry.accessCount * entry.tokenCost : 0;

      if (priority < bestPriority) {
        bestKey = key;
        bestPriority = priority;
      }
    }

    // Re-insert non-evicted candidates back into SIEVE
    for (const key of candidates) {
      if (key !== bestKey) {
        this.sieve.insert(key);
      }
    }

    // Remove the lowest-priority entry
    if (bestKey) {
      this.entries.delete(bestKey);
    }
  }

  /** Apply +/-jitterFactor randomization to TTL */
  private applyJitter(ttlMs: number): number {
    const factor = 1 - this.jitterFactor + Math.random() * 2 * this.jitterFactor;
    return Math.round(ttlMs * factor);
  }
}
