/**
 * @nekte/client — NEKTE Protocol Client
 *
 * Client library for interacting with NEKTE agents.
 * Features progressive discovery (L0/L1/L2), zero-schema
 * invocation via version hash caching, and budget-aware requests.
 *
 * @example
 * ```ts
 * const client = new NekteClient('http://localhost:4001');
 * const catalog = await client.catalog();
 * const result = await client.invoke('sentiment', {
 *   input: { text: 'Great product!' },
 *   budget: { max_tokens: 50, detail_level: 'minimal' },
 * });
 * ```
 */
export { NekteClient, NekteProtocolError, type NekteClientConfig } from './client.js';
export { CapabilityCache, type CacheConfig, type RevalidationFn } from './cache.js';
export {
  type CacheStore,
  type CacheStoreEntry,
  type CacheGetResult,
  InMemoryCacheStore,
} from './cache-store.js';
export { SharedInMemoryCache, type SharedCache } from './shared-cache.js';
export { RequestCoalescer } from './request-coalescer.js';

// Transport port (hexagonal architecture)
export { type Transport, type DelegateStream } from './transport.js';
export { HttpTransport, type HttpTransportConfig } from './http-transport.js';
export { createGrpcClientTransport, type GrpcClientTransportConfig } from './grpc-transport.js';
