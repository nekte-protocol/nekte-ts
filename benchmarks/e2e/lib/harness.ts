/**
 * Server Harness
 *
 * Spins up a real NekteServer (and optionally a NekteBridge) for
 * end-to-end benchmarking. Provides pre-registered capabilities
 * with controllable latency for realistic testing.
 */

import { NekteServer, createHttpTransport, type HttpTransport } from '../../../packages/server/dist/index.js';
import { NekteClient } from '../../../packages/client/dist/index.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HarnessConfig {
  /** Number of capabilities to register. Default: 30 */
  capCount?: number;
  /** Simulated handler latency in ms. Default: 1 */
  handlerLatencyMs?: number;
  /** Server port. Default: 0 (auto) */
  port?: number;
}

export interface Harness {
  server: NekteServer;
  transport: HttpTransport;
  client: NekteClient;
  endpoint: string;
  capIds: string[];
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Capability factory
// ---------------------------------------------------------------------------

function registerCapabilities(
  server: NekteServer,
  count: number,
  latencyMs: number,
): string[] {
  const categories = ['nlp', 'search', 'data', 'code', 'media', 'infra'];
  const ids: string[] = [];

  for (let i = 0; i < count; i++) {
    const id = `bench-cap-${String(i).padStart(3, '0')}`;
    const cat = categories[i % categories.length];

    server.capability(id, {
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().optional(),
        options: z
          .object({
            verbose: z.boolean().optional(),
            format: z.string().optional(),
          })
          .optional(),
      }),
      outputSchema: z.object({
        results: z.array(
          z.object({
            id: z.string(),
            score: z.number(),
            content: z.string(),
          }),
        ),
        total: z.number(),
        ms: z.number(),
      }),
      category: cat,
      description: `Benchmark capability #${i}: performs ${cat} operations for load testing`,
      handler: async (input, ctx) => {
        // Simulate realistic handler work
        if (latencyMs > 0) {
          await new Promise((r) => setTimeout(r, latencyMs));
        }
        // Check abort signal
        if (ctx.signal.aborted) throw new Error('Aborted');

        return {
          results: Array.from({ length: 3 }, (_, j) => ({
            id: `result-${i}-${j}`,
            score: 0.95 - j * 0.1,
            content: `Result ${j} for query "${input.query}" from ${id}`,
          })),
          total: 3,
          ms: latencyMs,
        };
      },
      toMinimal: (out) => `${out.total} results (${out.ms}ms)`,
      toCompact: (out) => ({
        results: out.results.map((r) => ({ id: r.id, score: r.score })),
        total: out.total,
      }),
    });

    ids.push(id);
  }

  return ids;
}

// ---------------------------------------------------------------------------
// Harness factory
// ---------------------------------------------------------------------------

/**
 * Create a fully wired NekteServer + NekteClient for benchmarking.
 * The server runs on a real HTTP transport with real TCP connections.
 */
export async function createHarness(config?: HarnessConfig): Promise<Harness> {
  const capCount = config?.capCount ?? 30;
  const latencyMs = config?.handlerLatencyMs ?? 1;
  // Use a random high port to avoid collisions
  const port = config?.port ?? (40000 + Math.floor(Math.random() * 20000));

  const server = new NekteServer({
    agent: 'bench-agent',
    version: '1.0.0',
    logLevel: 'error', // Quiet during benchmarks
  });

  // Register delegate handler for streaming benchmarks
  server.onDelegate(async (task, stream, _context, signal) => {
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      if (signal.aborted) return;
      stream.progress(i + 1, steps, `Step ${i + 1}/${steps}`);
      if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
    }
    stream.complete(task.id, {
      minimal: 'Task completed',
      compact: { status: 'done', steps },
      full: { status: 'done', steps, task_id: task.id, details: 'Benchmark delegation complete' },
    });
  });

  const capIds = registerCapabilities(server, capCount, latencyMs);

  // Start on real TCP port
  const transport = await createHttpTransport(server, {
    port,
    hostname: '127.0.0.1',
    logLevel: 'error',
  });

  const actualPort = transport.port;
  const endpoint = `http://127.0.0.1:${actualPort}`;

  const client = new NekteClient(endpoint);

  return {
    server,
    transport,
    client,
    endpoint,
    capIds,
    close: () => transport.close(),
  };
}
