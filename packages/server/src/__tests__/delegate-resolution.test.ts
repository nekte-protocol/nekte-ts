/**
 * Delegate Resolution Tests
 *
 * Verifies that handleDelegate uses the filtering framework
 * (KeywordFilterStrategy by default) for scored capability matching.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';
import { createServer, type Server } from 'node:http';
import { NekteServer } from '../server.js';
import { NekteClient } from '@nekte/client';
import type {
  CapabilityFilterStrategy,
  FilterableCapability,
  FilteredCapability,
  FilterOptions,
} from '@nekte/core';

let server: NekteServer;
let httpServer: Server;
let client: NekteClient;
const PORT = 14568;

function createTestServer(filterStrategy?: CapabilityFilterStrategy): NekteServer {
  const srv = new NekteServer({
    agent: 'delegate-test',
    version: '1.0.0',
    logLevel: 'silent',
    filterStrategy,
  });

  srv.capability('sentiment', {
    inputSchema: z.object({ text: z.string() }).or(z.object({ id: z.string(), desc: z.string() })),
    outputSchema: z.object({ score: z.number(), label: z.string() }),
    category: 'nlp',
    description: 'Analyze text sentiment',
    handler: async () => ({ score: 0.9, label: 'positive' }),
    toMinimal: (out) => `${out.label} ${out.score}`,
  });

  srv.capability('summarize', {
    inputSchema: z.object({ text: z.string() }).or(z.object({ id: z.string(), desc: z.string() })),
    outputSchema: z.object({ summary: z.string() }),
    category: 'nlp',
    description: 'Summarize long text into a brief paragraph',
    handler: async () => ({ summary: 'A brief summary.' }),
    toMinimal: (out) => out.summary,
  });

  srv.capability('echo', {
    inputSchema: z.object({ msg: z.string() }).or(z.object({ id: z.string(), desc: z.string() })),
    outputSchema: z.object({ echo: z.string() }),
    category: 'util',
    description: 'Echo back the message',
    handler: async () => ({ echo: 'echoed' }),
    toMinimal: (out) => out.echo,
  });

  return srv;
}

beforeAll(async () => {
  server = createTestServer();

  httpServer = createServer(async (req, res) => {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: string) => (body += chunk));
      req.on('end', async () => {
        const request = JSON.parse(body);
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
});

describe('Delegate Resolution', () => {
  it('matches by exact capability name in task description', async () => {
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'nekte.delegate',
      params: {
        task: {
          id: 'task-1',
          desc: 'sentiment',
          budget: { max_tokens: 500, detail_level: 'compact' },
        },
      },
    });

    const result = response.result as any;
    expect(result).toBeDefined();
    expect(result.status).toBe('completed');
    expect(result.task_id).toBe('task-1');
  });

  it('matches by words in capability description', async () => {
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'nekte.delegate',
      params: {
        task: {
          id: 'task-2',
          desc: 'summarize long text',
          budget: { max_tokens: 500, detail_level: 'compact' },
        },
      },
    });

    const result = response.result as any;
    expect(result).toBeDefined();
    expect(result.status).toBe('completed');
  });

  it('returns NO_MATCHING_CAPABILITY when nothing matches', async () => {
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'nekte.delegate',
      params: {
        task: {
          id: 'task-3',
          desc: 'xyznonexistent',
          budget: { max_tokens: 500, detail_level: 'compact' },
        },
      },
    });

    const result = response.result as any;
    expect(result).toBeDefined();
    expect(result.status).toBe('failed');
    expect(result.error.code).toBe('NO_MATCHING_CAPABILITY');
  });

  it('picks best match when multiple candidates exist', async () => {
    // "sentiment" should match the sentiment capability, not summarize,
    // even though both are NLP capabilities
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'nekte.delegate',
      params: {
        task: {
          id: 'task-4',
          desc: 'analyze sentiment of text',
          budget: { max_tokens: 500, detail_level: 'compact' },
        },
      },
    });

    const result = response.result as any;
    expect(result).toBeDefined();
    expect(result.status).toBe('completed');
    // The result should come from the sentiment handler (score 0.9)
    // compact falls back to full object when toCompact is not defined
    expect(result.out.compact.score).toBe(0.9);
    expect(result.out.compact.label).toBe('positive');
  });

  it('uses custom filterStrategy when configured', async () => {
    // Custom strategy that always returns 'echo' regardless of query
    const customStrategy: CapabilityFilterStrategy = {
      async filter(
        capabilities: FilterableCapability[],
        _query: string,
        _options?: FilterOptions,
      ): Promise<FilteredCapability[]> {
        const echo = capabilities.find((c) => c.id === 'echo');
        return echo ? [{ id: echo.id, score: 1.0 }] : [];
      },
    };

    const customServer = createTestServer(customStrategy);

    const response = await customServer.handleRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'nekte.delegate',
      params: {
        task: {
          id: 'task-5',
          desc: 'sentiment analysis',
          budget: { max_tokens: 500, detail_level: 'compact' },
        },
      },
    });

    const result = response.result as any;
    expect(result).toBeDefined();
    expect(result.status).toBe('completed');
    // Should have used echo handler despite "sentiment" in desc
    expect(result.out.compact.echo).toBe('echoed');
  });
});
