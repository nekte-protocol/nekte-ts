/**
 * Integration test: NekteClient ↔ NekteServer
 *
 * Spins up a real HTTP server, connects a client, and exercises
 * the full protocol flow: discover → invoke → zero-schema → budget.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';
import { createServer, type Server } from 'node:http';
import { NekteServer } from '../server.js';
import { NekteClient, NekteProtocolError } from '@nekte/client';

let server: NekteServer;
let httpServer: Server;
let client: NekteClient;
const PORT = 14567;

beforeAll(async () => {
  server = new NekteServer({ agent: 'test-agent', version: '1.0.0', logLevel: 'silent' });

  server.capability('sentiment', {
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.object({ score: z.number(), label: z.string() }),
    category: 'nlp',
    description: 'Analyze text sentiment',
    handler: async (input) => {
      const positive =
        input.text.toLowerCase().includes('great') || input.text.toLowerCase().includes('love');
      return {
        score: positive ? 0.92 : 0.15,
        label: positive ? 'positive' : 'negative',
      };
    },
    toMinimal: (out) => `${out.label} ${out.score}`,
    toCompact: (out) => ({ s: out.label, v: out.score }),
  });

  server.capability('echo', {
    inputSchema: z.object({ msg: z.string() }),
    outputSchema: z.object({ echo: z.string() }),
    category: 'util',
    description: 'Echo back the message',
    handler: async (input) => ({ echo: input.msg }),
    toMinimal: (out) => out.echo,
  });

  // Start raw HTTP server (avoid listen() which logs)
  httpServer = createServer(async (req, res) => {
    if (req.url === '/.well-known/nekte.json' && req.method === 'GET') {
      const card = server.agentCard(`http://localhost:${PORT}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(card));
      return;
    }
    if (req.url === '/api/protocol-guide' && req.method === 'GET') {
      const { PROTOCOL_GUIDE_FULL } = await import('@nekte/core');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(PROTOCOL_GUIDE_FULL);
      return;
    }
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

describe('Agent Card', () => {
  it('fetches agent card from well-known endpoint', async () => {
    const card = await client.agentCard();
    expect(card.agent).toBe('test-agent');
    expect(card.nekte).toBe('0.2.0');
    expect(card.caps).toContain('sentiment');
    expect(card.caps).toContain('echo');
    expect(card.budget_support).toBe(true);
  });

  it('includes compact protocol instructions', async () => {
    const card = await client.agentCard();
    expect(card.instructions).toBeDefined();
    expect(typeof card.instructions).toBe('string');
    expect(card.instructions!.length).toBeGreaterThan(50);
    expect(card.instructions).toContain('nekte.discover');
    expect(card.instructions).toContain('budget');
  });
});

describe('Protocol Guide endpoint', () => {
  it('GET /api/protocol-guide returns plain text with full guide', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/protocol-guide`);
    expect(res.ok).toBe(true);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain('nekte.discover');
    expect(text).toContain('nekte.invoke');
    expect(text).toContain('budget');
    expect(text.length).toBeGreaterThan(200);
  });
});

describe('nekte.introspect', () => {
  async function introspect(topic?: string) {
    const res = await fetch(`http://localhost:${PORT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'nekte.introspect',
        id: 1,
        params: topic ? { topic } : {},
      }),
    });
    return (await res.json()) as { result: { guide: string } };
  }

  it('returns full guide when no topic specified', async () => {
    const { result } = await introspect();
    expect(result.guide).toBeDefined();
    expect(result.guide).toContain('nekte.discover');
    expect(result.guide).toContain('nekte.invoke');
  });

  it('returns budget section for topic=budget', async () => {
    const { result } = await introspect('budget');
    expect(result.guide).toContain('max_tokens');
    expect(result.guide).toContain('detail_level');
  });

  it('returns discovery section for topic=discovery', async () => {
    const { result } = await introspect('discovery');
    expect(result.guide).toContain('L0');
    expect(result.guide).toContain('L1');
    expect(result.guide).toContain('L2');
  });

  it('returns errors section for topic=errors', async () => {
    const { result } = await introspect('errors');
    expect(result.guide).toContain('-32001');
    expect(result.guide).toContain('VERSION_MISMATCH');
  });

  it('returns tasks section for topic=tasks', async () => {
    const { result } = await introspect('tasks');
    expect(result.guide).toContain('nekte.delegate');
    expect(result.guide).toContain('nekte.task.cancel');
  });
});

describe('Progressive Discovery', () => {
  it('L0: returns compact catalog (~8 tok/cap)', async () => {
    const result = await client.catalog();
    expect(result.agent).toBe('test-agent');
    expect(result.caps).toHaveLength(2);
    // L0 should only have id, cat, h
    const cap = result.caps[0] as any;
    expect(cap.id).toBeDefined();
    expect(cap.cat).toBeDefined();
    expect(cap.h).toBeDefined();
    expect(cap.desc).toBeUndefined();
    expect(cap.input).toBeUndefined();
  });

  it('L1: includes descriptions', async () => {
    const result = await client.describe('sentiment');
    const cap = result.caps[0] as any;
    expect(cap.desc).toBe('Analyze text sentiment');
    expect(cap.input).toBeUndefined();
  });

  it('L2: includes full schemas', async () => {
    const result = await client.schema('sentiment');
    const cap = result.caps[0] as any;
    expect(cap.input).toBeDefined();
    expect(cap.output).toBeDefined();
    expect(cap.input.properties).toHaveProperty('text');
  });

  it('filters by category', async () => {
    const result = await client.discover({ level: 0, filter: { category: 'util' } });
    expect(result.caps).toHaveLength(1);
    expect(result.caps[0].id).toBe('echo');
  });
});

describe('Invocation', () => {
  it('invokes capability with full budget', async () => {
    const result = await client.invoke('sentiment', {
      input: { text: 'I love this product' },
      budget: { max_tokens: 4096, detail_level: 'full' },
    });
    expect(result.out).toBeDefined();
    expect(result.meta?.ms).toBeGreaterThanOrEqual(0);
  });

  it('invokes with minimal budget', async () => {
    const result = await client.invoke('sentiment', {
      input: { text: 'great stuff' },
      budget: { max_tokens: 20, detail_level: 'minimal' },
    });
    expect(result.resolved_level).toBe('minimal');
  });

  it('zero-schema invocation uses cached hash', async () => {
    // First call populates cache
    await client.invoke('echo', { input: { msg: 'hello' } });
    // Second call should use cached hash (no extra schema overhead)
    const result = await client.invoke('echo', { input: { msg: 'world' } });
    expect(result.out).toBeDefined();
  });
});

describe('Error Handling', () => {
  it('throws NekteProtocolError for unknown capability', async () => {
    try {
      await client.invoke('nonexistent', { input: {} });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(NekteProtocolError);
      expect((err as NekteProtocolError).isCapabilityNotFound).toBe(true);
    }
  });
});
