/**
 * gRPC Transport — Infrastructure Adapter (Hexagonal Architecture)
 *
 * Decouples gRPC server concerns from the NekteServer domain.
 * Follows the same factory pattern as createWsTransport and createHttpTransport.
 *
 * Each gRPC RPC method:
 *   1. Converts proto message → domain type (anti-corruption layer)
 *   2. Delegates to NekteServer.handleRequest() or TaskRegistry
 *   3. Converts domain response → proto message
 *
 * For Delegate: Uses server-streaming RPC with GrpcDelegateStream
 * adapter so DelegateHandlers work identically across transports.
 *
 * Dependencies: @grpc/grpc-js (peer dependency, not bundled)
 */

import type { NekteServer } from './server.js';
import type { TaskRegistry } from './task-registry.js';
import { GrpcDelegateStream, type GrpcWritableStream } from './grpc-stream.js';
import {
  createLogger,
  type Logger,
  type LogLevel,
  type NekteRequest,
  type DelegateParams,
  // Proto converters
  fromProtoDiscoverRequest,
  fromProtoInvokeRequest,
  fromProtoDelegateRequest,
  fromProtoTaskCancelRequest,
  fromProtoTaskResumeRequest,
  fromProtoTaskStatusRequest,
  toProtoDiscoverResponse,
  toProtoInvokeResponse,
} from '@nekte/core';

// ---------------------------------------------------------------------------
// Config & types
// ---------------------------------------------------------------------------

export interface GrpcTransportConfig {
  /** Port for gRPC server */
  port: number;
  /** Optional hostname. Default: '0.0.0.0' */
  hostname?: string;
  /** Log level. Default: 'info' */
  logLevel?: LogLevel;
  /** Path to .proto file. Default: auto-resolved from @nekte/core */
  protoPath?: string;
  /** Task registry for lifecycle methods. Optional — lifecycle RPCs fail without it. */
  taskRegistry?: TaskRegistry;
  /** TLS root certificate (PEM). Enables TLS when provided. */
  tlsRootCert?: Buffer;
  /** TLS private key (PEM). Required when tlsRootCert is set. */
  tlsPrivateKey?: Buffer;
  /** TLS certificate chain (PEM). Required when tlsRootCert is set. */
  tlsCertChain?: Buffer;
}

export interface GrpcTransport {
  /** The underlying gRPC server instance */
  readonly server: unknown;
  /** Gracefully close the transport */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a gRPC transport adapter for a NekteServer.
 *
 * Requires @grpc/grpc-js and @grpc/proto-loader as peer dependencies.
 * These are dynamically imported to keep the dependency optional.
 */
export async function createGrpcTransport(
  nekteServer: NekteServer,
  config: GrpcTransportConfig,
): Promise<GrpcTransport> {
  const log = createLogger('nekte:grpc', config.logLevel);
  const hostname = config.hostname ?? '0.0.0.0';
  const registry = config.taskRegistry;

  // Dynamic import — @grpc/grpc-js is an optional peer dependency
  const grpc = await import('@grpc/grpc-js');
  const protoLoader = await import('@grpc/proto-loader');

  // Resolve proto file path
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
  const NekteService = (nekteProto.Nekte as { service: unknown }).service;

  // -----------------------------------------------------------------------
  // RPC implementations
  // -----------------------------------------------------------------------

  const serviceImpl = {
    /**
     * Discover — Unary RPC
     */
    async Discover(
      call: { request: unknown },
      callback: (err: unknown, response?: unknown) => void,
    ) {
      try {
        const params = fromProtoDiscoverRequest(call.request as never);
        const request: NekteRequest = {
          jsonrpc: '2.0',
          method: 'nekte.discover',
          id: 'grpc',
          params,
        };
        const response = await nekteServer.handleRequest(request);
        if (response.error) {
          callback({ code: grpc.status.INTERNAL, message: response.error.message });
          return;
        }
        callback(null, toProtoDiscoverResponse(response.result as never));
      } catch (err) {
        log.error('Discover error', { error: (err as Error).message });
        callback({ code: grpc.status.INTERNAL, message: (err as Error).message });
      }
    },

    /**
     * Invoke — Unary RPC
     */
    async Invoke(call: { request: unknown }, callback: (err: unknown, response?: unknown) => void) {
      try {
        const params = fromProtoInvokeRequest(call.request as never);
        const request: NekteRequest = {
          jsonrpc: '2.0',
          method: 'nekte.invoke',
          id: 'grpc',
          params,
        };
        const response = await nekteServer.handleRequest(request);
        if (response.error) {
          callback({
            code: grpc.status.INTERNAL,
            message: response.error.message,
            details: JSON.stringify(response.error.data),
          });
          return;
        }
        callback(null, toProtoInvokeResponse(response.result as never));
      } catch (err) {
        log.error('Invoke error', { error: (err as Error).message });
        callback({ code: grpc.status.INTERNAL, message: (err as Error).message });
      }
    },

    /**
     * Delegate — Server-streaming RPC
     */
    async Delegate(call: { request: unknown; write: (msg: unknown) => boolean; end: () => void }) {
      try {
        const params = fromProtoDelegateRequest(call.request as never);
        const grpcStream = new GrpcDelegateStream(call as GrpcWritableStream);

        if (nekteServer.delegateHandler) {
          const taskRegistry = registry ?? nekteServer.tasks;
          const entry = taskRegistry.register(params.task, params.context);
          const signal = entry.abortController.signal;

          try {
            taskRegistry.transition(params.task.id, 'accepted');
            taskRegistry.transition(params.task.id, 'running');

            await nekteServer.delegateHandler(
              params.task,
              grpcStream as never,
              params.context,
              signal,
            );

            if (!signal.aborted) {
              taskRegistry.transition(params.task.id, 'completed');
            }
          } catch (err) {
            if (signal.aborted) {
              // Cancelled via abort signal — already transitioned
            } else {
              const msg = err instanceof Error ? err.message : String(err);
              if (!grpcStream.isClosed) grpcStream.error(-32007, msg, params.task.id);
              try {
                taskRegistry.transition(params.task.id, 'failed', msg);
              } catch {
                /* already terminal */
              }
            }
          }

          if (!grpcStream.isClosed) grpcStream.close();
        } else {
          // No delegate handler — fall back to handleRequest
          const request: NekteRequest = {
            jsonrpc: '2.0',
            method: 'nekte.delegate',
            id: 'grpc',
            params,
          };
          const response = await nekteServer.handleRequest(request);
          call.write(response.result);
          call.end();
        }
      } catch (err) {
        log.error('Delegate error', { error: (err as Error).message });
        call.end();
      }
    },

    /**
     * Context — Unary RPC
     */
    async Context(
      call: { request: unknown },
      callback: (err: unknown, response?: unknown) => void,
    ) {
      try {
        const proto = call.request as { action: string; envelope: unknown };
        const request: NekteRequest = {
          jsonrpc: '2.0',
          method: 'nekte.context',
          id: 'grpc',
          params: {
            action: proto.action,
            envelope: proto.envelope,
          },
        };
        const response = await nekteServer.handleRequest(request);
        if (response.error) {
          callback({ code: grpc.status.INTERNAL, message: response.error.message });
          return;
        }
        callback(null, response.result);
      } catch (err) {
        callback({ code: grpc.status.INTERNAL, message: (err as Error).message });
      }
    },

    /**
     * Verify — Unary RPC
     */
    async Verify(call: { request: unknown }, callback: (err: unknown, response?: unknown) => void) {
      try {
        const request: NekteRequest = {
          jsonrpc: '2.0',
          method: 'nekte.verify',
          id: 'grpc',
          params: call.request,
        };
        const response = await nekteServer.handleRequest(request);
        if (response.error) {
          callback({ code: grpc.status.INTERNAL, message: response.error.message });
          return;
        }
        callback(null, response.result);
      } catch (err) {
        callback({ code: grpc.status.INTERNAL, message: (err as Error).message });
      }
    },

    /**
     * TaskCancel — Unary RPC
     */
    async TaskCancel(
      call: { request: unknown },
      callback: (err: unknown, response?: unknown) => void,
    ) {
      if (!registry) {
        callback({ code: grpc.status.UNIMPLEMENTED, message: 'Task registry not configured' });
        return;
      }
      try {
        const params = fromProtoTaskCancelRequest(call.request as never);
        const entry = registry.getOrThrow(params.task_id);
        const previousStatus = entry.status;
        registry.cancel(params.task_id, params.reason);
        callback(null, registry.toLifecycleResult(entry, previousStatus));
      } catch (err) {
        const e = err as Error & { code?: number };
        callback({
          code: e.code === -32009 ? grpc.status.NOT_FOUND : grpc.status.FAILED_PRECONDITION,
          message: e.message,
        });
      }
    },

    /**
     * TaskResume — Unary RPC
     */
    async TaskResume(
      call: { request: unknown },
      callback: (err: unknown, response?: unknown) => void,
    ) {
      if (!registry) {
        callback({ code: grpc.status.UNIMPLEMENTED, message: 'Task registry not configured' });
        return;
      }
      try {
        const params = fromProtoTaskResumeRequest(call.request as never);
        const entry = registry.getOrThrow(params.task_id);
        const previousStatus = entry.status;
        registry.resume(params.task_id);
        callback(null, registry.toLifecycleResult(entry, previousStatus));
      } catch (err) {
        const e = err as Error & { code?: number };
        callback({
          code: e.code === -32009 ? grpc.status.NOT_FOUND : grpc.status.FAILED_PRECONDITION,
          message: e.message,
        });
      }
    },

    /**
     * TaskStatus — Unary RPC
     */
    async TaskStatus(
      call: { request: unknown },
      callback: (err: unknown, response?: unknown) => void,
    ) {
      if (!registry) {
        callback({ code: grpc.status.UNIMPLEMENTED, message: 'Task registry not configured' });
        return;
      }
      try {
        const params = fromProtoTaskStatusRequest(call.request as never);
        callback(null, registry.toStatusResult(params.task_id));
      } catch (err) {
        const e = err as Error & { code?: number };
        callback({
          code: e.code === -32009 ? grpc.status.NOT_FOUND : grpc.status.INTERNAL,
          message: e.message,
        });
      }
    },
  };

  // -----------------------------------------------------------------------
  // Start server
  // -----------------------------------------------------------------------

  const server = new grpc.Server();
  server.addService(NekteService as never, serviceImpl as never);

  const credentials =
    config.tlsRootCert && config.tlsPrivateKey && config.tlsCertChain
      ? grpc.ServerCredentials.createSsl(config.tlsRootCert, [
          { private_key: config.tlsPrivateKey, cert_chain: config.tlsCertChain },
        ])
      : grpc.ServerCredentials.createInsecure();

  if (!config.tlsRootCert) {
    log.warn('gRPC server starting WITHOUT TLS — do not use in production');
  }

  return new Promise((resolve, reject) => {
    server.bindAsync(
      `${hostname}:${config.port}`,
      credentials,
      (err) => {
        if (err) {
          reject(err);
          return;
        }

        log.info(`gRPC transport on ${hostname}:${config.port}`);
        resolve({
          server,
          close: () =>
            new Promise<void>((res) => {
              server.tryShutdown(() => res());
            }),
        });
      },
    );
  });
}
