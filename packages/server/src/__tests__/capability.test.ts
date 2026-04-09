import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { CapabilityRegistry } from '../capability.js';

const inputSchema = z.object({ text: z.string() });
const outputSchema = z.object({ score: z.number(), label: z.string() });

function makeConfig() {
  return {
    inputSchema,
    outputSchema,
    category: 'nlp',
    description: 'Analyze sentiment',
    handler: async (input: { text: string }) => ({
      score: 0.9,
      label: 'positive',
    }),
    toMinimal: (out: { score: number; label: string }) => `${out.label} ${out.score}`,
    toCompact: (out: { score: number; label: string }) => ({
      s: out.label,
      v: out.score,
    }),
  };
}

describe('CapabilityRegistry', () => {
  it('registers and retrieves capability', () => {
    const registry = new CapabilityRegistry();
    const registered = registry.register('sentiment', makeConfig());
    expect(registered.id).toBe('sentiment');
    expect(registered.versionHash).toMatch(/^[0-9a-f]{16}$/);
    expect(registry.get('sentiment')).toBe(registered);
  });

  it('generates stable version hash', () => {
    const r1 = new CapabilityRegistry();
    const r2 = new CapabilityRegistry();
    r1.register('sentiment', makeConfig());
    r2.register('sentiment', makeConfig());
    expect(r1.get('sentiment')!.versionHash).toBe(r2.get('sentiment')!.versionHash);
  });

  it('lists all capabilities', () => {
    const registry = new CapabilityRegistry();
    registry.register('sentiment', makeConfig());
    registry.register('summarize', {
      ...makeConfig(),
      category: 'nlp',
      description: 'Summarize text',
    });
    expect(registry.all()).toHaveLength(2);
  });

  it('filters by category', () => {
    const registry = new CapabilityRegistry();
    registry.register('sentiment', makeConfig());
    registry.register('translate', { ...makeConfig(), category: 'translation' });
    expect(registry.filter({ category: 'nlp' })).toHaveLength(1);
  });

  it('filters by query string', () => {
    const registry = new CapabilityRegistry();
    registry.register('sentiment', makeConfig());
    registry.register('translate', { ...makeConfig(), description: 'Translate text' });
    expect(registry.filter({ query: 'sentiment' })).toHaveLength(1);
  });

  it('filters by id', () => {
    const registry = new CapabilityRegistry();
    registry.register('sentiment', makeConfig());
    registry.register('translate', makeConfig());
    expect(registry.filter({ id: 'sentiment' })).toHaveLength(1);
  });

  it('invokes capability and returns multi-level result', async () => {
    const registry = new CapabilityRegistry();
    registry.register('sentiment', makeConfig());

    const result = await registry.invoke(
      'sentiment',
      { text: 'great' },
      {
        budget: { max_tokens: 500, detail_level: 'compact' },
        signal: new AbortController().signal,
      },
    );

    expect(result.minimal).toBe('positive 0.9');
    expect(result.compact).toEqual({ s: 'positive', v: 0.9 });
    expect(result.full).toHaveProperty('_meta');
  });

  it('throws on unknown capability', async () => {
    const registry = new CapabilityRegistry();
    await expect(
      registry.invoke(
        'nope',
        {},
        {
          budget: { max_tokens: 100, detail_level: 'compact' },
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toThrow('Capability not found: nope');
  });

  it('propagates agent_hint through schema and L1 projection', () => {
    const registry = new CapabilityRegistry();
    registry.register('sentiment', {
      ...makeConfig(),
      agent_hint: 'Use when you need text sentiment. Input: text string.',
    });
    const cap = registry.get('sentiment')!;
    expect(cap.schema.agent_hint).toBe('Use when you need text sentiment. Input: text string.');
  });

  it('omits agent_hint from schema when not provided', () => {
    const registry = new CapabilityRegistry();
    registry.register('sentiment', makeConfig());
    const cap = registry.get('sentiment')!;
    expect(cap.schema.agent_hint).toBeUndefined();
  });

  it('validates input with Zod', async () => {
    const registry = new CapabilityRegistry();
    registry.register('sentiment', makeConfig());
    await expect(
      registry.invoke(
        'sentiment',
        { text: 123 },
        {
          budget: { max_tokens: 100, detail_level: 'compact' },
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toThrow();
  });
});
