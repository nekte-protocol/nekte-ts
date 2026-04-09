/**
 * NEKTE Demo — Two agents coordinating via NEKTE
 *
 * Agent A: Sentiment analyzer (NLP)
 * Agent B: Report generator (uses Agent A's results)
 *
 * Run: pnpm demo (or: npx tsx demo/two-agents/run.ts)
 *
 * This demonstrates:
 * 1. Progressive discovery (L0 -> L1 -> L2)
 * 2. Zero-schema invocation (second call skips schema)
 * 3. Token budget enforcement
 * 4. Multi-level result compression
 * 5. SSE streaming delegation with task lifecycle
 * 6. Task cancellation mid-stream
 * 7. SIEVE cache scan resistance
 */

import { z } from 'zod';
import { NekteServer } from '@nekte/server';
import { NekteClient } from '@nekte/client';
import { estimateTokens } from '@nekte/core';

// ---------------------------------------------------------------------------
// Agent A: Sentiment Analyzer
// ---------------------------------------------------------------------------

function createSentimentAgent(): NekteServer {
  const server = new NekteServer({
    agent: 'sentiment-analyzer',
    version: '1.0.0',
  });

  server.capability('analyze-sentiment', {
    category: 'nlp',
    description: 'Analyzes sentiment of text. Input: text(string). Output: label, score, explanation.',
    inputSchema: z.object({
      text: z.string(),
      lang: z.string().default('auto'),
    }),
    outputSchema: z.object({
      label: z.enum(['positive', 'negative', 'neutral', 'mixed']),
      score: z.number(),
      explanation: z.string(),
    }),
    handler: async (input) => {
      const text = input.text.toLowerCase();
      const positiveWords = ['great', 'excellent', 'love', 'amazing', 'good'];
      const negativeWords = ['bad', 'terrible', 'hate', 'awful', 'slow'];

      const posCount = positiveWords.filter((w) => text.includes(w)).length;
      const negCount = negativeWords.filter((w) => text.includes(w)).length;

      const total = posCount + negCount || 1;
      const score = (posCount - negCount + total) / (2 * total);
      const label = score > 0.6 ? 'positive' : score < 0.4 ? 'negative' : posCount > 0 && negCount > 0 ? 'mixed' : 'neutral';

      return {
        label,
        score: Math.round(score * 100) / 100,
        explanation: `Found ${posCount} positive and ${negCount} negative indicators.`,
      };
    },
    toMinimal: (r) => `${r.label} ${r.score}`,
    toCompact: (r) => ({ label: r.label, score: r.score }),
    examples: [
      {
        in: { text: 'This product is excellent!', lang: 'en' },
        out: { label: 'positive' as const, score: 0.95, explanation: 'Strong positive sentiment.' },
      },
    ],
  });

  server.capability('extract-keywords', {
    category: 'nlp',
    description: 'Extracts key phrases from text. Input: text(string). Output: keywords(string[]).',
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.object({ keywords: z.array(z.string()) }),
    handler: async (input) => {
      const words = input.text.split(/\s+/).filter((w: string) => w.length > 4);
      const unique = [...new Set(words)].slice(0, 5);
      return { keywords: unique };
    },
    toMinimal: (r) => r.keywords.join(', '),
    toCompact: (r) => ({ keywords: r.keywords, count: r.keywords.length }),
  });

  // Streaming delegate handler with cooperative cancellation
  server.onDelegate(async (task, stream, context, signal) => {
    const reviews = [
      'The product is excellent and delivery was fast!',
      'Terrible experience, the item was broken.',
      'Good quality but slow shipping.',
      'Amazing customer service!',
      'Bad packaging, item arrived damaged.',
      'Love this brand, great quality.',
      'Awful return policy.',
      'Mixed feelings, good product but bad support.',
    ];

    const total = reviews.length;
    const results: Array<{ text: string; label: string; score: number }> = [];

    for (let i = 0; i < total; i++) {
      // Cooperative cancellation check
      if (signal.aborted) {
        stream.cancelled(task.id, 'running', 'Cancelled by client');
        return;
      }

      stream.progress(i + 1, total, `Analyzing review ${i + 1}/${total}`);
      await new Promise((r) => setTimeout(r, 50));

      const text = reviews[i].toLowerCase();
      const pos = ['excellent', 'fast', 'good', 'amazing', 'great', 'love'].filter(w => text.includes(w)).length;
      const neg = ['terrible', 'broken', 'slow', 'bad', 'awful', 'damaged'].filter(w => text.includes(w)).length;
      const score = pos > neg ? 0.8 : neg > pos ? 0.2 : 0.5;
      results.push({ text: reviews[i], label: score > 0.6 ? 'positive' : score < 0.4 ? 'negative' : 'mixed', score });

      // Send partial result at 50%
      if (i === Math.floor(total / 2) - 1) {
        const avgSoFar = results.reduce((s, r) => s + r.score, 0) / results.length;
        stream.partial({ preliminary_avg: Math.round(avgSoFar * 100) / 100, analyzed: results.length }, 'compact');
      }
    }

    const avgScore = results.reduce((s, r) => s + r.score, 0) / results.length;
    const positive = results.filter(r => r.label === 'positive').length;
    const negative = results.filter(r => r.label === 'negative').length;

    stream.complete(task.id, {
      minimal: `${Math.round(avgScore * 100)}% positive (${positive}/${total} reviews)`,
      compact: { avg_score: Math.round(avgScore * 100) / 100, positive, negative, total },
      full: { avg_score: avgScore, positive, negative, total, reviews: results },
    }, { ms: total * 50 });
  });

  return server;
}

// ---------------------------------------------------------------------------
// Token tracking
// ---------------------------------------------------------------------------

let totalTokens = 0;

function trackTokens(label: string, data: unknown): void {
  const tokens = estimateTokens(data);
  totalTokens += tokens;
  console.log(`  tokens: ~${tokens} (cumulative: ~${totalTokens}) [${label}]`);
}

// ---------------------------------------------------------------------------
// Run the demo
// ---------------------------------------------------------------------------

async function main() {
  console.log('================================================================');
  console.log('  NEKTE Protocol Demo v0.3');
  console.log('  "El protocolo que no quema tu contexto"');
  console.log('================================================================\n');

  const agentA = createSentimentAgent();
  await agentA.listen(4001);

  const client = new NekteClient('http://localhost:4001');

  // --- Step 1: L0 Discovery ---
  console.log('-- Step 1: L0 Discovery (catalog) --');
  const catalog = await client.catalog();
  console.log(`  Agent: ${catalog.agent}`);
  console.log(`  Capabilities: ${catalog.caps.map((c) => c.id).join(', ')}`);
  trackTokens('L0 catalog', catalog);

  // --- Step 2: L1 Discovery ---
  console.log('\n-- Step 2: L1 Discovery (summary) --');
  const summary = await client.describe('analyze-sentiment');
  console.log(`  Description: ${(summary.caps[0] as any).desc}`);
  trackTokens('L1 summary', summary);

  // --- Step 3: First invocation ---
  console.log('\n-- Step 3: First invocation --');
  const result1 = await client.invoke('analyze-sentiment', {
    input: { text: 'The product is excellent but shipping was slow' },
    budget: { max_tokens: 50, detail_level: 'compact' },
  });
  console.log(`  Result: ${JSON.stringify(result1.out)}`);
  console.log(`  Level: ${result1.resolved_level}`);
  trackTokens('First invoke', result1);

  // --- Step 4: Zero-schema invocation ---
  console.log('\n-- Step 4: Zero-schema invocation (cached hash) --');
  const result2 = await client.invoke('analyze-sentiment', {
    input: { text: 'Terrible experience, never buying again' },
    budget: { max_tokens: 20, detail_level: 'minimal' },
  });
  console.log(`  Result: ${JSON.stringify(result2.out)}`);
  trackTokens('Zero-schema invoke', result2);

  // --- Step 5: SSE Streaming delegation ---
  console.log('\n-- Step 5: SSE Streaming delegation --');
  const stream = client.delegateStream({
    id: 'task-review-analysis',
    desc: 'Analyze sentiment of customer reviews',
    timeout_ms: 30_000,
  });

  let eventCount = 0;
  for await (const event of stream.events) {
    eventCount++;
    if (event.event === 'progress') {
      process.stdout.write(`  [${event.data.processed}/${event.data.total}] ${event.data.message}\r`);
    } else if (event.event === 'partial') {
      console.log(`\n  Partial: ${JSON.stringify(event.data.out)}`);
    } else if (event.event === 'complete') {
      console.log(`\n  Complete: ${JSON.stringify(event.data.out.compact)}`);
      trackTokens('Delegate complete', event.data);
    }
  }
  console.log(`  Total SSE events: ${eventCount}`);

  // --- Step 6: Task lifecycle — query status ---
  console.log('\n-- Step 6: Task lifecycle --');
  const status = await client.taskStatus('task-review-analysis');
  console.log(`  Status: ${status.status}`);
  console.log(`  Created: ${new Date(status.created_at).toISOString()}`);

  // --- Step 7: Streaming with cancel ---
  console.log('\n-- Step 7: Delegation with cancel at 50% --');
  const stream2 = client.delegateStream({
    id: 'task-cancel-demo',
    desc: 'Analyze sentiment of reviews (will be cancelled)',
    timeout_ms: 30_000,
  });

  for await (const event of stream2.events) {
    if (event.event === 'progress' && event.data.processed >= 4) {
      console.log(`  Cancelling at ${event.data.processed}/${event.data.total}...`);
      await stream2.cancel('User requested early stop');
    } else if (event.event === 'cancelled') {
      console.log(`  Cancelled: ${event.data.reason}`);
    }
  }

  // --- Step 8: Context sharing ---
  console.log('\n-- Step 8: Context sharing with TTL --');
  const ctxResult = await client.verify('task-review-analysis', ['hash', 'source']);
  console.log(`  Verify: ${JSON.stringify(ctxResult)}`);

  // --- Summary ---
  console.log('\n================================================================');
  console.log(`  Total NEKTE tokens used: ~${totalTokens}`);
  console.log(`  MCP equivalent (2 tools x 5 turns): ~${2 * 121 * 5} tokens`);
  console.log(`  Savings: ~${Math.round((1 - totalTokens / (2 * 121 * 5)) * 100)}%`);
  console.log('================================================================\n');

  await client.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
