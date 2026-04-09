/**
 * @nekte/server — NEKTE Protocol Server
 *
 * Server library for building NEKTE agents. Register typed
 * capabilities with Zod schemas, auto-generate version hashes,
 * and serve via HTTP with multi-level result compression.
 *
 * @example
 * ```ts
 * const server = new NekteServer({ agent: 'nlp-worker', version: '1.0.0' });
 * server.capability('sentiment', {
 *   inputSchema: z.object({ text: z.string() }),
 *   outputSchema: z.object({ score: z.number() }),
 *   category: 'nlp',
 *   description: 'Analyze text sentiment',
 *   handler: async (input) => ({ score: 0.9 }),
 * });
 * server.listen(4001);
 * ```
 */
export { NekteServer, type NekteServerConfig } from './server.js';
export {
  CapabilityRegistry,
  type CapabilityConfig,
  type CapabilityHandler,
  type HandlerContext,
  type RegisteredCapability,
} from './capability.js';
export { createWsTransport, type WsTransport, type WsTransportConfig } from './ws-transport.js';
export { noAuth, bearerAuth, apiKeyAuth, type AuthHandler, type AuthResult } from './auth.js';
export {
  createHttpTransport,
  type HttpTransport,
  type HttpTransportConfig,
} from './http-transport.js';
export { SseStream } from './sse-stream.js';
export { type DelegateHandler } from './server.js';

// Task lifecycle (DDD domain service + repository)
export {
  TaskRegistry,
  type TaskRegistryConfig,
  type TaskRegistryEvent,
  type TaskRegistryListener,
  TaskNotFoundError,
  TaskNotCancellableError,
  TaskNotResumableError,
} from './task-registry.js';

// gRPC transport (infrastructure adapter)
export {
  createGrpcTransport,
  type GrpcTransport,
  type GrpcTransportConfig,
} from './grpc-transport.js';
export { GrpcDelegateStream, type GrpcWritableStream } from './grpc-stream.js';
