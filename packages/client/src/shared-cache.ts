/**
 * Shared Cache — Cross-Agent Cache Sharing Adapter
 *
 * Allows multiple NekteClient instances to share a single cache store.
 * When Agent A discovers capabilities from Agent B, Agent C can
 * reuse that discovery without re-requesting.
 *
 * @example
 * ```ts
 * const shared = new SharedInMemoryCache({ maxEntries: 5000 });
 *
 * const clientA = new NekteClient('http://agent-b:4001', { sharedCache: shared });
 * const clientC = new NekteClient('http://agent-b:4001', { sharedCache: shared });
 *
 * await clientA.catalog(); // discovers and caches
 * await clientC.invoke('sentiment', { input: { text: 'hi' } }); // uses cached hash
 * ```
 */

import {
  InMemoryCacheStore,
  type CacheStore,
  type InMemoryStoreConfig,
  type CacheGetResult,
} from './cache-store.js';

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

/**
 * Port: a shared cache that multiple clients can reference.
 */
export interface SharedCache {
  /** Get the shared backing store */
  store(): CacheStore;
  /** Subscribe to invalidation events */
  onInvalidate(callback: (key: string) => void): () => void;
  /** Notify all subscribers of an invalidation */
  notifyInvalidation(key: string): void;
}

// ---------------------------------------------------------------------------
// Adapter: In-Memory Shared Cache
// ---------------------------------------------------------------------------

/**
 * In-memory shared cache with invalidation notifications.
 */
export class SharedInMemoryCache implements SharedCache {
  private readonly _store: InMemoryCacheStore;
  private listeners = new Set<(key: string) => void>();

  constructor(config?: InMemoryStoreConfig) {
    this._store = new InMemoryCacheStore(config);
  }

  store(): CacheStore {
    return this._store;
  }

  onInvalidate(callback: (key: string) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notifyInvalidation(key: string): void {
    for (const listener of this.listeners) {
      listener(key);
    }
  }

  /** Current store size */
  get size(): number {
    return this._store.size;
  }

  /** Clear the entire shared store */
  clear(): void {
    this._store.clear();
  }
}
