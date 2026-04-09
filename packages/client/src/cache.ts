/**
 * Capability Cache — Application Service (Hexagonal Architecture)
 *
 * Client-side cache for version hashes and capability schemas.
 * Enables zero-schema invocation: if the hash hasn't changed,
 * skip the schema reload entirely.
 *
 * Cache strategies (CPU architecture + distributed systems inspired):
 *   - SIEVE eviction for scan resistance (via CacheStore)
 *   - GDSF token-cost weighting (via CacheStore)
 *   - Stale-while-revalidate: serve stale data, refresh in background
 *   - Negative caching: remember "capability doesn't exist"
 *   - TTL jitter: prevent stampedes (via CacheStore)
 */

import type { Capability, DiscoveryLevel } from '@nekte/core';
import { tokenCostForLevel } from '@nekte/core';
import { InMemoryCacheStore, type CacheStore, type CacheStoreEntry } from './cache-store.js';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

interface CacheEntryData {
  levels: Partial<Record<DiscoveryLevel, Capability>>;
  hash: string;
  maxLevel: DiscoveryLevel;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface CacheConfig {
  /** Default TTL for cache entries (ms). Default: 5 minutes */
  defaultTtlMs?: number;
  /** Maximum number of entries. Default: 1000 */
  maxEntries?: number;
  /** Pluggable backing store. Default: InMemoryCacheStore */
  store?: CacheStore;
  /** Key namespace prefix (for multi-environment shared stores) */
  namespace?: string;
  /** TTL for negative cache entries (ms). Default: 60_000 (1 minute) */
  negativeTtlMs?: number;
}

// ---------------------------------------------------------------------------
// Revalidation callback
// ---------------------------------------------------------------------------

/** Callback fired when a stale entry needs background refresh */
export type RevalidationFn = (agentId: string, capId: string) => void;

// ---------------------------------------------------------------------------
// CapabilityCache
// ---------------------------------------------------------------------------

export class CapabilityCache {
  private readonly store: CacheStore;
  private readonly defaultTtlMs: number;
  private readonly namespace: string;
  private readonly negativeTtlMs: number;

  /** Negative cache: keys known not to exist (value = expiry timestamp) */
  private readonly negatives = new Map<string, number>();

  /** Keys currently being revalidated (prevent duplicate refreshes) */
  private readonly revalidating = new Set<string>();

  /** Background revalidation callback */
  private revalidationFn?: RevalidationFn;

  constructor(config?: CacheConfig) {
    this.defaultTtlMs = config?.defaultTtlMs ?? 5 * 60 * 1000;
    this.namespace = config?.namespace ? `${config.namespace}:` : '';
    this.negativeTtlMs = config?.negativeTtlMs ?? 60_000;
    this.store =
      config?.store ?? new InMemoryCacheStore({ maxEntries: config?.maxEntries ?? 1000 });
  }

  /**
   * Register the background revalidation function.
   * Wired by NekteClient to trigger discover() for stale entries.
   */
  onRevalidate(fn: RevalidationFn): void {
    this.revalidationFn = fn;
  }

  /**
   * Store a capability at a given discovery level.
   * Clears any negative cache entry for this capability.
   */
  set(agentId: string, cap: Capability, level: DiscoveryLevel, ttlMs?: number): void {
    const key = this.key(agentId, cap.id);

    // Clear negative cache — this capability exists
    this.negatives.delete(key);

    // Preserve existing levels
    const existing = this.store.get(key);
    const existingData = existing?.entry.data as CacheEntryData | undefined;
    const existingMaxLevel = existingData?.maxLevel ?? 0;

    const data: CacheEntryData = existingData
      ? {
          ...existingData,
          hash: cap.h,
          maxLevel: Math.max(existingMaxLevel, level) as DiscoveryLevel,
        }
      : { levels: {}, hash: cap.h, maxLevel: level };

    data.levels[level] = cap;

    this.store.set(key, {
      data,
      cachedAt: Date.now(),
      ttlMs: ttlMs ?? this.defaultTtlMs,
      accessCount: existing?.entry.accessCount ?? 0,
      tokenCost: tokenCostForLevel(data.maxLevel),
    });
  }

  /**
   * Get the version hash for a capability.
   * Supports stale-while-revalidate: stale entries trigger background refresh.
   */
  getHash(agentId: string, capId: string): string | undefined {
    const result = this.getEntry(agentId, capId);
    return result?.hash;
  }

  /**
   * Get a cached capability at a specific level.
   */
  get(agentId: string, capId: string, level: DiscoveryLevel): Capability | undefined {
    const result = this.getEntry(agentId, capId);
    return result?.levels[level];
  }

  /**
   * Check if a version hash is still valid.
   */
  isValid(agentId: string, capId: string, hash: string): boolean {
    return this.getHash(agentId, capId) === hash;
  }

  // -----------------------------------------------------------------------
  // Negative caching
  // -----------------------------------------------------------------------

  /**
   * Record that a capability does NOT exist at an agent.
   * Subsequent lookups return undefined without hitting the store.
   */
  setNegative(agentId: string, capId: string): void {
    this.negatives.set(this.key(agentId, capId), Date.now() + this.negativeTtlMs);
  }

  /**
   * Check if a capability is negatively cached (known not to exist).
   */
  isNegative(agentId: string, capId: string): boolean {
    const key = this.key(agentId, capId);
    const expiry = this.negatives.get(key);
    if (expiry === undefined) return false;
    if (Date.now() > expiry) {
      this.negatives.delete(key);
      return false;
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Invalidation
  // -----------------------------------------------------------------------

  invalidate(agentId: string, capId: string): void {
    this.store.delete(this.key(agentId, capId));
  }

  invalidateAgent(agentId: string): void {
    const prefix = `${this.namespace}${agentId}:`;
    for (const key of [...this.store.keys()]) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
    for (const key of [...this.negatives.keys()]) {
      if (key.startsWith(prefix)) this.negatives.delete(key);
    }
  }

  clear(): void {
    this.store.clear();
    this.negatives.clear();
    this.revalidating.clear();
  }

  stats(): { size: number; agents: number; negatives: number } {
    const agents = new Set<string>();
    for (const key of this.store.keys()) {
      const withoutNs = key.startsWith(this.namespace) ? key.slice(this.namespace.length) : key;
      agents.add(withoutNs.split(':')[0]);
    }
    return { size: this.store.size, agents: agents.size, negatives: this.negatives.size };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private key(agentId: string, capId: string): string {
    return `${this.namespace}${agentId}:${capId}`;
  }

  /**
   * Get entry with stale-while-revalidate support.
   * Fresh entries are returned directly. Stale entries are returned
   * AND trigger a background refresh. Expired entries return undefined.
   */
  private getEntry(agentId: string, capId: string): CacheEntryData | undefined {
    if (this.isNegative(agentId, capId)) return undefined;

    const key = this.key(agentId, capId);
    const result = this.store.get(key);
    if (!result) return undefined;

    const data = result.entry.data as CacheEntryData;
    if (!data || typeof data !== 'object' || !('hash' in data)) return undefined;

    // Stale-while-revalidate: serve stale data + trigger background refresh
    if (result.freshness === 'stale') {
      this.triggerRevalidation(agentId, capId, key);
    }

    return data;
  }

  /** Fire background revalidation (at most once per key concurrently) */
  private triggerRevalidation(agentId: string, capId: string, key: string): void {
    if (!this.revalidationFn || this.revalidating.has(key)) return;
    this.revalidating.add(key);
    // The revalidation fn is fire-and-forget. The revalidating set prevents
    // concurrent duplicates. We clear the key after a cooldown so that if the
    // entry goes stale again later, it can be re-revalidated.
    // The cooldown timer is unref'd so it doesn't keep the process alive.
    const timer = setTimeout(() => this.revalidating.delete(key), 5000);
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
    this.revalidationFn(agentId, capId);
  }
}
