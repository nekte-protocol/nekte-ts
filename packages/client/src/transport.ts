/**
 * Transport Port — Hexagonal Architecture
 *
 * The primary outbound port for NEKTE protocol communication.
 * The NekteClient depends only on this abstraction — never on
 * concrete transports (HTTP, gRPC, WebSocket).
 *
 * All methods return strongly-typed domain objects. Streaming uses
 * AsyncGenerator for natural consumption in agent loops.
 */

import type { NekteMethod, NekteResponse, SseEvent } from '@nekte/core';

// ---------------------------------------------------------------------------
// Transport Port
// ---------------------------------------------------------------------------

export interface Transport {
  /** Send a JSON-RPC request and receive the parsed response. */
  rpc<T>(method: NekteMethod, params: unknown): Promise<NekteResponse<T>>;

  /** Send a request and receive a stream of SSE events. */
  stream(method: NekteMethod, params: unknown): AsyncGenerator<SseEvent>;

  /** Perform a plain GET request (e.g., Agent Card discovery). */
  get<T>(url: string): Promise<T>;

  /** Close the transport and release resources. */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Delegate Stream (with lifecycle control)
// ---------------------------------------------------------------------------

/**
 * A delegate stream with lifecycle control.
 *
 * Returned by `client.delegateStream()`. Iterate `events` to consume
 * SSE events; call `cancel()` to abort the task server-side.
 *
 * @example
 * ```ts
 * const stream = client.delegateStream(task);
 * for await (const event of stream.events) {
 *   if (shouldAbort) await stream.cancel('user requested');
 * }
 * ```
 */
export interface DelegateStream {
  /** The async generator yielding SSE events */
  readonly events: AsyncGenerator<SseEvent>;
  /** Cancel the task server-side and close the stream */
  cancel(reason?: string): Promise<void>;
  /** The task ID being tracked */
  readonly taskId: string;
}
