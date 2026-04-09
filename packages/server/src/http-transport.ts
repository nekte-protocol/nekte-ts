/**
 * HTTP Transport — Infrastructure Adapter (Hexagonal Architecture)
 *
 * Decouples HTTP server concerns from the NekteServer domain.
 * Handles routing, body parsing, CORS, auth, and SSE delegation.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { NekteRequest, DelegateParams } from '@nekte/core';
import {
  WELL_KNOWN_PATH,
  PROTOCOL_GUIDE_PATH,
  PROTOCOL_GUIDE_FULL,
  createLogger,
  type Logger,
  type LogLevel,
} from '@nekte/core';
import type { NekteServer } from './server.js';
import type { AuthHandler } from './auth.js';
import { noAuth } from './auth.js';
import { SseStream } from './sse-stream.js';

/** Maximum request body size in bytes (10 MB) */
const MAX_BODY_SIZE = 10 * 1024 * 1024;
/** Request timeout in milliseconds (30 seconds) */
const REQUEST_TIMEOUT_MS = 30_000;

export interface HttpTransportConfig {
  port: number;
  hostname?: string;
  logLevel?: LogLevel;
  authHandler?: AuthHandler;
}

export interface HttpTransport {
  readonly server: Server;
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Create an HTTP transport adapter for a NekteServer.
 * This is the infrastructure layer — the NekteServer domain stays clean.
 */
export function createHttpTransport(
  nekteServer: NekteServer,
  config: HttpTransportConfig,
): Promise<HttpTransport> {
  const hostname = config.hostname ?? '0.0.0.0';
  const auth = config.authHandler ?? nekteServer.config.authHandler ?? noAuth();
  const log = createLogger(
    `nekte:http:${nekteServer.config.agent}`,
    config.logLevel ?? nekteServer.config.logLevel,
  );

  return new Promise((resolve) => {
    const httpServer = createServer(async (req, res) => {
      // Request timeout to prevent Slowloris attacks
      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        if (!res.headersSent) sendJson(res, 408, { error: 'Request timeout' });
        req.destroy();
      });

      // Agent Card discovery (public, no auth)
      if (req.url === WELL_KNOWN_PATH && req.method === 'GET') {
        const card = nekteServer.agentCard(`http://${hostname}:${config.port}`);
        sendJson(res, 200, card);
        return;
      }

      // Protocol guide for LLM system prompt injection (public, no auth, cacheable)
      if (req.url === PROTOCOL_GUIDE_PATH && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(PROTOCOL_GUIDE_FULL);
        return;
      }

      // NEKTE JSON-RPC endpoint
      if (req.method === 'POST') {
        // Validate Content-Type
        const contentType = req.headers['content-type'];
        if (!contentType || !contentType.includes('application/json')) {
          sendJson(res, 415, { error: 'Unsupported Media Type: expected application/json' });
          return;
        }

        const authResult = await auth(req);
        if (!authResult.ok) {
          sendJson(res, authResult.status, { error: authResult.message });
          return;
        }

        try {
          const body = await readBody(req);
          const request = JSON.parse(body) as NekteRequest;

          // SSE streaming for delegate
          if (request.method === 'nekte.delegate' && nekteServer.delegateHandler) {
            const params = request.params as DelegateParams;
            const stream = new SseStream(res);

            // Register task in lifecycle registry
            const entry = nekteServer.tasks.register(params.task, params.context);
            const signal = entry.abortController.signal;

            try {
              nekteServer.tasks.transition(params.task.id, 'accepted');
              nekteServer.tasks.transition(params.task.id, 'running');

              await nekteServer.delegateHandler(params.task, stream, params.context, signal);

              if (!signal.aborted) {
                nekteServer.tasks.transition(params.task.id, 'completed');
              }
              if (!stream.isClosed) stream.close();
            } catch (err) {
              if (signal.aborted) {
                // Cancelled via abort — stream already handled by cancel endpoint
                if (!stream.isClosed) stream.close();
              } else {
                const msg = err instanceof Error ? err.message : String(err);
                if (!stream.isClosed) stream.error(-32007, msg, params.task.id);
                try {
                  nekteServer.tasks.transition(params.task.id, 'failed', msg);
                } catch {
                  /* already terminal */
                }
              }
            }
            return;
          }

          const response = await nekteServer.handleRequest(request);
          sendJson(res, 200, response);
        } catch (err) {
          const message =
            err instanceof Error && err.message === 'Request body too large'
              ? 'Request body too large'
              : 'Internal server error';
          const status = message === 'Request body too large' ? 413 : 500;
          sendJson(res, status, { jsonrpc: '2.0', id: 0, error: { code: -32000, message } });
        }
        return;
      }

      res.writeHead(404).end();
    });

    httpServer.listen(config.port, hostname, () => {
      log.info(`Listening on http://${hostname}:${config.port}`);
      log.info(`Agent Card: http://${hostname}:${config.port}${WELL_KNOWN_PATH}`);
      resolve({
        server: httpServer,
        port: config.port,
        close: () => new Promise<void>((r) => httpServer.close(() => r())),
      });
    });
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer | string) => {
      const len = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      size += len;
      if (size > MAX_BODY_SIZE) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
