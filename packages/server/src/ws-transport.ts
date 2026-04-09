/**
 * WebSocket Transport for NekteServer
 *
 * Enables bidirectional, low-latency agent communication.
 * Uses the native Node.js WebSocket (no dependencies).
 *
 * Usage:
 *   import { NekteServer } from '@nekte/server';
 *   import { createWsTransport } from '@nekte/server';
 *
 *   const server = new NekteServer({ agent: 'my-agent' });
 *   // ... register capabilities ...
 *   const wss = createWsTransport(server, { port: 4002 });
 */

import { WebSocketServer, type WebSocket } from 'ws';
import type { NekteServer } from './server.js';
import { createLogger, type Logger, type LogLevel } from '@nekte/core';

export interface WsTransportConfig {
  /** Port for WebSocket server */
  port: number;
  /** Optional hostname. Default: '0.0.0.0' */
  hostname?: string;
  /** Log level. Default: 'info' */
  logLevel?: LogLevel;
  /** Allowed WebSocket origins. If empty, all origins accepted. Default: [] */
  allowedOrigins?: string[];
  /** Maximum message size in bytes. Default: 256KB */
  maxPayload?: number;
  /** Maximum concurrent connections. Default: 1000 */
  maxConnections?: number;
}

export interface WsTransport {
  /** The underlying WebSocketServer */
  wss: WebSocketServer;
  /** Number of connected clients */
  readonly connections: number;
  /** Gracefully close the transport */
  close(): Promise<void>;
}

/**
 * Create a WebSocket transport for a NekteServer.
 * Each incoming message is treated as a JSON-RPC request
 * and dispatched to server.handleRequest().
 */
export function createWsTransport(server: NekteServer, config: WsTransportConfig): WsTransport {
  const log = createLogger('nekte:ws', config.logLevel);
  const clients = new Set<WebSocket>();
  const maxConnections = config.maxConnections ?? 1000;
  const allowedOrigins = new Set(config.allowedOrigins ?? []);

  const wss = new WebSocketServer({
    port: config.port,
    host: config.hostname ?? '0.0.0.0',
    maxPayload: config.maxPayload ?? 256 * 1024, // 256KB default
    verifyClient: (info, cb) => {
      // Connection limit
      if (clients.size >= maxConnections) {
        cb(false, 503, 'Too many connections');
        return;
      }
      // Origin validation (skip if no origins configured)
      if (allowedOrigins.size > 0) {
        const origin = info.origin ?? info.req.headers.origin;
        if (!origin || !allowedOrigins.has(origin)) {
          cb(false, 403, 'Origin not allowed');
          return;
        }
      }
      cb(true);
    },
  });

  wss.on('listening', () => {
    log.info(`WebSocket transport on ws://${config.hostname ?? '0.0.0.0'}:${config.port}`);
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    log.debug('Client connected', { total: clients.size });

    // Ping/pong keepalive to detect dead connections
    const pingInterval = setInterval(() => ws.ping(), 30_000);

    ws.on('message', async (data) => {
      try {
        const raw = typeof data === 'string' ? data : data.toString();
        const request = JSON.parse(raw);
        const response = await server.handleRequest(request);
        ws.send(JSON.stringify(response));
      } catch (err) {
        const errorResponse = {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Parse error',
          },
        };
        ws.send(JSON.stringify(errorResponse));
      }
    });

    ws.on('close', () => {
      clearInterval(pingInterval);
      clients.delete(ws);
      log.debug('Client disconnected', { total: clients.size });
    });

    ws.on('error', (err) => {
      clearInterval(pingInterval);
      log.error('Client error', { error: err.message });
      clients.delete(ws);
    });
  });

  return {
    wss,
    get connections() {
      return clients.size;
    },
    close() {
      return new Promise<void>((resolve) => {
        for (const ws of clients) {
          ws.close();
        }
        wss.close(() => resolve());
      });
    },
  };
}
