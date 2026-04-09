/**
 * gRPC Transport Adapter — Infrastructure Layer
 *
 * Transport adapter for gRPC communication with NEKTE servers.
 * Maps the Transport port interface to gRPC client calls.
 *
 * Hexagonal: Adapter for the Transport port.
 * Requires @grpc/grpc-js and @grpc/proto-loader as peer dependencies.
 *
 * Usage:
 *   const transport = await createGrpcClientTransport({
 *     endpoint: 'localhost:4002',
 *   });
 *   const client = new NekteClient('grpc://localhost:4002', { transport });
 */

import type { NekteMethod, NekteResponse, SseEvent } from '@nekte/core';
import {
  fromProtoDelegateEvent,
  fromProtoTaskLifecycleResponse,
  fromProtoTaskStatusResponse,
  jsonToBytes,
  toProtoTokenBudget,
  toProtoTask,
  toProtoContextEnvelope,
} from '@nekte/core';
import type { Transport } from './transport.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface GrpcClientTransportConfig {
  /** gRPC server address (host:port) */
  endpoint: string;
  /** Path to .proto file. Default: auto-resolved from @nekte/core */
  protoPath?: string;
  /** TLS root certificate (PEM). Enables TLS when provided. */
  tlsRootCert?: Buffer;
  /** TLS private key (PEM). Optional — for mutual TLS. */
  tlsPrivateKey?: Buffer;
  /** TLS certificate chain (PEM). Optional — for mutual TLS. */
  tlsCertChain?: Buffer;
}

// ---------------------------------------------------------------------------
// Method mapping: NekteMethod → gRPC RPC name
// ---------------------------------------------------------------------------

const METHOD_MAP: Record<string, string> = {
  'nekte.discover': 'Discover',
  'nekte.invoke': 'Invoke',
  'nekte.delegate': 'Delegate',
  'nekte.context': 'Context',
  'nekte.verify': 'Verify',
  'nekte.task.cancel': 'TaskCancel',
  'nekte.task.resume': 'TaskResume',
  'nekte.task.status': 'TaskStatus',
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a gRPC client transport.
 * Dynamically imports @grpc/grpc-js — it's an optional peer dependency.
 */
export async function createGrpcClientTransport(
  config: GrpcClientTransportConfig,
): Promise<Transport> {
  const grpc = await import('@grpc/grpc-js');
  const protoLoader = await import('@grpc/proto-loader');

  const protoPath =
    config.protoPath ?? new URL('../../proto/nekte.proto', import.meta.url).pathname;

  const packageDef = await protoLoader.load(protoPath, {
    keepCase: true,
    longs: Number,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const protoDescriptor = grpc.loadPackageDefinition(packageDef);
  const nekteProto = (protoDescriptor.nekte as Record<string, unknown>).v1 as Record<
    string,
    unknown
  >;
  const NekteClient = nekteProto.Nekte as new (
    address: string,
    credentials: unknown,
    options?: Record<string, unknown>,
  ) => Record<string, (...args: unknown[]) => unknown>;

  const channelOptions: Record<string, unknown> = {
    // Keepalive: detect dead connections on long-lived delegate streams
    'grpc.keepalive_time_ms': 20_000,
    'grpc.keepalive_timeout_ms': 5_000,
    'grpc.keepalive_permit_without_calls': 1,
    'grpc.http2.min_time_between_pings_ms': 10_000,
  };

  const credentials = config.tlsRootCert
    ? grpc.credentials.createSsl(
        config.tlsRootCert,
        config.tlsPrivateKey ?? null,
        config.tlsCertChain ?? null,
      )
    : grpc.credentials.createInsecure();

  const client = new NekteClient(config.endpoint, credentials, channelOptions);

  // -----------------------------------------------------------------------
  // Param converters (domain → proto request shape)
  // -----------------------------------------------------------------------

  function toProtoParams(method: NekteMethod, params: unknown): unknown {
    const p = params as Record<string, unknown>;

    switch (method) {
      case 'nekte.discover':
        return { level: p.level, filter: p.filter };

      case 'nekte.invoke':
        return {
          cap: p.cap,
          h: p.h,
          input: jsonToBytes(p.in),
          budget: p.budget ? toProtoTokenBudget(p.budget as never) : undefined,
        };

      case 'nekte.delegate':
        return {
          task: toProtoTask(p.task as never),
          context: p.context ? toProtoContextEnvelope(p.context as never) : undefined,
        };

      case 'nekte.task.cancel':
        return { task_id: p.task_id, reason: p.reason };

      case 'nekte.task.resume':
        return {
          task_id: p.task_id,
          budget: p.budget ? toProtoTokenBudget(p.budget as never) : undefined,
        };

      case 'nekte.task.status':
        return { task_id: p.task_id };

      default:
        return params;
    }
  }

  // -----------------------------------------------------------------------
  // Transport implementation
  // -----------------------------------------------------------------------

  return {
    async rpc<T>(method: NekteMethod, params: unknown): Promise<NekteResponse<T>> {
      const rpcName = METHOD_MAP[method];
      if (!rpcName) {
        return {
          jsonrpc: '2.0',
          id: 0,
          error: { code: -32601, message: `Unknown method: ${method}` },
        };
      }

      const protoParams = toProtoParams(method, params);

      return new Promise((resolve) => {
        const fn = client[rpcName] as (
          request: unknown,
          callback: (err: unknown, response?: unknown) => void,
        ) => void;

        fn.call(client, protoParams, (err: unknown, response?: unknown) => {
          if (err) {
            const e = err as { code?: number; message?: string; details?: string };
            resolve({
              jsonrpc: '2.0',
              id: 0,
              error: {
                code: e.code ?? -32000,
                message: e.message ?? 'gRPC error',
                data: e.details,
              },
            });
            return;
          }

          // Convert proto response back to domain types for task lifecycle
          let result = response as T;
          if (method === 'nekte.task.cancel' || method === 'nekte.task.resume') {
            result = fromProtoTaskLifecycleResponse(response as never) as unknown as T;
          } else if (method === 'nekte.task.status') {
            result = fromProtoTaskStatusResponse(response as never) as unknown as T;
          }

          resolve({ jsonrpc: '2.0', id: 0, result });
        });
      });
    },

    async *stream(method: NekteMethod, params: unknown): AsyncGenerator<SseEvent> {
      const rpcName = METHOD_MAP[method];
      if (!rpcName) return;

      const protoParams = toProtoParams(method, params);
      const fn = client[rpcName] as (
        request: unknown,
      ) => AsyncIterable<unknown> & {
        on: (event: string, cb: (...args: unknown[]) => void) => void;
      };
      const call = fn.call(client, protoParams);

      // gRPC server-streaming returns a readable stream with 'data' and 'end' events
      const events: SseEvent[] = [];
      let resolve: (() => void) | null = null;
      let done = false;
      let error: Error | null = null;

      call.on('data', (data: unknown) => {
        const event = fromProtoDelegateEvent(data as never);
        if (event) {
          events.push(event);
          resolve?.();
        }
      });

      call.on('end', () => {
        done = true;
        resolve?.();
      });

      call.on('error', (err: unknown) => {
        error = err instanceof Error ? err : new Error(String(err));
        done = true;
        resolve?.();
      });

      while (true) {
        if (events.length > 0) {
          yield events.shift()!;
          continue;
        }
        if (done) {
          if (error) throw error;
          return;
        }
        await new Promise<void>((r) => {
          resolve = r;
        });
        resolve = null;
      }
    },

    async get<T>(url: string): Promise<T> {
      // gRPC doesn't support raw GET — fall back to HTTP for Agent Card
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return (await res.json()) as T;
    },

    async close(): Promise<void> {
      (client as unknown as { close: () => void }).close();
    },
  };
}
