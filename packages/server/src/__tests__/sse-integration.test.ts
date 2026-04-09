/**
 * Integration test: SSE streaming for nekte.delegate
 *
 * Verifies that the server streams progress → partial → complete
 * events over SSE, and the client can consume them via DelegateStream.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';
import { createServer, type Server } from 'node:http';
import { NekteServer, SseStream } from '../index.js';
import { NekteClient } from '@nekte/client';
import { parseSseStream, type SseEvent } from '@nekte/core';

let server: NekteServer;
let httpServer: Server;
let client: NekteClient;
const PORT = 14569;

beforeAll(async () => {
  server = new NekteServer({ agent: 'sse-test-agent', logLevel: 'silent' });

  server.capability('analyze', {
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.object({ score: z.number() }),
    category: 'nlp',
    description: 'Analyze text',
    handler: async (input) => ({ score: 0.9 }),
  });

  // Register a streaming delegate handler (signal is required)
  server.onDelegate(async (task, stream, _context, signal) => {
    const total = 3;
    for (let i = 1; i <= total; i++) {
      if (signal.aborted) return;
      stream.progress(i, total, `Step ${i}`);
      await new Promise((r) => setTimeout(r, 10));
    }

    stream.partial({ preliminary: 0.8 }, 'compact');

    stream.complete(
      task.id,
      {
        minimal: 'done 0.85',
        compact: { score: 0.85 },
        full: { score: 0.85, details: 'full analysis' },
      },
      { ms: 30 },
    );
  });

  // Start raw HTTP server (bypassing createHttpTransport for test isolation)
  httpServer = createServer(async (req, res) => {
    if (req.url === '/.well-known/nekte.json' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(server.agentCard(`http://localhost:${PORT}`)));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: string) => (body += chunk));
      req.on('end', async () => {
        const request = JSON.parse(body);

        // Route delegate to SSE with task registry
        if (request.method === 'nekte.delegate') {
          const params = request.params;
          const sseStream = new SseStream(res);
          const entry = server.tasks.register(params.task, params.context);
          const signal = entry.abortController.signal;

          try {
            server.tasks.transition(params.task.id, 'accepted');
            server.tasks.transition(params.task.id, 'running');
            await (server as any).delegateHandler(params.task, sseStream, params.context, signal);
            if (!signal.aborted) server.tasks.transition(params.task.id, 'completed');
            if (!sseStream.isClosed) sseStream.close();
          } catch (err: any) {
            if (!sseStream.isClosed) sseStream.error(-32007, err.message, params.task?.id);
            try {
              server.tasks.transition(params.task.id, 'failed', err.message);
            } catch {
              /* already terminal */
            }
          }
          return;
        }

        const response = await server.handleRequest(request);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      });
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => httpServer.listen(PORT, resolve));
  client = new NekteClient(`http://localhost:${PORT}`);
});

afterAll(() => {
  httpServer?.close();
  server.tasks.dispose();
});

describe('SSE Streaming Delegate', () => {
  it('streams progress, partial, and complete events', async () => {
    const events: SseEvent[] = [];
    const stream = client.delegateStream({
      id: 'task-sse-001',
      desc: 'Test streaming task',
      timeout_ms: 5000,
    });

    for await (const event of stream.events) {
      events.push(event);
    }

    // Should have: 3 progress + 1 partial + 1 complete = 5 events
    expect(events.length).toBe(5);

    const progress = events.filter((e) => e.event === 'progress');
    expect(progress).toHaveLength(3);
    expect(progress[0].data).toEqual({ processed: 1, total: 3, message: 'Step 1' });
    expect(progress[2].data).toEqual({ processed: 3, total: 3, message: 'Step 3' });

    const partial = events.find((e) => e.event === 'partial');
    expect(partial).toBeDefined();
    expect(partial!.data).toEqual({ out: { preliminary: 0.8 }, resolved_level: 'compact' });

    const complete = events.find((e) => e.event === 'complete');
    expect(complete).toBeDefined();
    expect(complete!.data).toHaveProperty('task_id', 'task-sse-001');
    expect(complete!.data).toHaveProperty('status', 'completed');

    // Verify task was tracked in registry
    expect(stream.taskId).toBe('task-sse-001');
  });

  it('handles errors gracefully via SSE', async () => {
    const originalHandler = (server as any).delegateHandler;

    server.onDelegate(async (_task, stream, _context, signal) => {
      stream.progress(1, 2);
      throw new Error('Something broke');
    });

    const events: SseEvent[] = [];
    const stream = client.delegateStream({
      id: 'task-sse-err',
      desc: 'This will fail',
      timeout_ms: 5000,
    });

    for await (const event of stream.events) {
      events.push(event);
    }

    expect(events.length).toBe(2); // 1 progress + 1 error
    const errorEvent = events.find((e) => e.event === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.data).toHaveProperty('message', 'Something broke');

    // Restore original handler
    (server as any).delegateHandler = originalHandler;
  });
});
