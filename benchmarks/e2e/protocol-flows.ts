/**
 * Protocol Flow Pipeline Benchmark
 *
 * Measures end-to-end latency of realistic multi-step protocol flows
 * that agents actually execute. Each flow is a complete sequence of
 * NEKTE primitives measured as a pipeline.
 */

import { createHarness, type Harness } from './lib/harness.js';
import { MetricsCollector, type MetricsSnapshot } from './lib/metrics.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FlowResult {
  name: string;
  description: string;
  latency: MetricsSnapshot;
  step_breakdown_ms: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Flow definitions
// ---------------------------------------------------------------------------

/** Flow A: First contact — discover catalog, then schema, then invoke */
async function flowFirstContact(harness: Harness): Promise<Record<string, number>> {
  const steps: Record<string, number> = {};

  let t = performance.now();
  const l0 = await harness.client.catalog();
  steps.discover_L0 = performance.now() - t;

  const firstCap = l0.caps?.[0]?.id ?? harness.capIds[0];

  t = performance.now();
  await harness.client.schema(firstCap);
  steps.discover_L2 = performance.now() - t;

  t = performance.now();
  await harness.client.invoke(firstCap, { input: { query: 'test' } });
  steps.invoke = performance.now() - t;

  return steps;
}

/** Flow B: Cached invocation — invoke with hash (zero-schema) */
async function flowCachedInvoke(harness: Harness): Promise<Record<string, number>> {
  const steps: Record<string, number> = {};
  const capId = harness.capIds[0];

  // Pre-fetch schema to warm cache
  await harness.client.schema(capId);

  let t = performance.now();
  await harness.client.invoke(capId, { input: { query: 'cached test' } });
  steps.invoke_cached = performance.now() - t;

  return steps;
}

/** Flow C: Streaming delegation — delegate and consume full SSE stream */
async function flowDelegate(harness: Harness): Promise<Record<string, number>> {
  const steps: Record<string, number> = {};
  const taskId = `flow-c-${Date.now()}`;

  const t = performance.now();

  const body = JSON.stringify({
    jsonrpc: '2.0',
    method: 'nekte.delegate',
    id: 1,
    params: {
      task: { id: taskId, desc: 'Flow C benchmark', cap: harness.capIds[0] },
    },
  });

  const res = await fetch(harness.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  let firstEventAt = 0;
  let lastEventAt = 0;
  let eventCount = 0;

  if (res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop()!;
      for (const part of parts) {
        if (!part.trim() || !part.includes('event:')) continue;
        eventCount++;
        if (eventCount === 1) firstEventAt = performance.now();
        lastEventAt = performance.now();
      }
    }
  }

  steps.total = performance.now() - t;
  steps.ttfe = firstEventAt ? firstEventAt - t : steps.total;
  steps.stream_duration = lastEventAt > firstEventAt ? lastEventAt - firstEventAt : 0;
  steps.events = eventCount;

  return steps;
}

/** Flow D: Context sharing — share context, invoke with context, revoke */
async function flowContext(harness: Harness): Promise<Record<string, number>> {
  const steps: Record<string, number> = {};
  const contextId = `ctx-flow-d-${Date.now()}`;

  // Share context
  let t = performance.now();
  await fetch(harness.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'nekte.context',
      id: 1,
      params: {
        action: 'share',
        envelope: {
          id: contextId,
          data: { user: 'bench-user', session: 'bench-session' },
          permissions: { read: true, forward: false },
          ttl_s: 300,
        },
      },
    }),
  });
  steps.context_share = performance.now() - t;

  // Request context
  t = performance.now();
  await fetch(harness.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'nekte.context',
      id: 2,
      params: {
        action: 'request',
        envelope: { id: contextId },
      },
    }),
  });
  steps.context_request = performance.now() - t;

  // Revoke context
  t = performance.now();
  await fetch(harness.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'nekte.context',
      id: 3,
      params: {
        action: 'revoke',
        envelope: { id: contextId },
      },
    }),
  });
  steps.context_revoke = performance.now() - t;

  return steps;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function benchFlow(
  name: string,
  description: string,
  harness: Harness,
  flowFn: (h: Harness) => Promise<Record<string, number>>,
  runs: number = 100,
  warmup: number = 20,
): Promise<FlowResult> {
  const metrics = new MetricsCollector();

  // Warmup
  for (let i = 0; i < warmup; i++) await flowFn(harness);

  // Measured runs
  const allSteps: Record<string, number[]> = {};
  metrics.start();

  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    const steps = await flowFn(harness);
    const totalMs = performance.now() - t;
    metrics.recordMicros(totalMs * 1000);

    for (const [key, val] of Object.entries(steps)) {
      if (!allSteps[key]) allSteps[key] = [];
      allSteps[key].push(val);
    }
  }

  const snapshot = metrics.stop();

  // Average step breakdown
  const avgSteps: Record<string, number> = {};
  for (const [key, vals] of Object.entries(allSteps)) {
    avgSteps[key] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
  }

  return {
    name,
    description,
    latency: snapshot,
    step_breakdown_ms: avgSteps,
  };
}

export async function runProtocolFlows(runs?: number): Promise<FlowResult[]> {
  const numRuns = runs ?? 100;
  const results: FlowResult[] = [];

  const harness = await createHarness({
    capCount: 30,
    handlerLatencyMs: 1,
  });

  try {
    results.push(await benchFlow(
      'Flow A: First contact',
      'L0 discover → L2 discover(cap) → invoke',
      harness, flowFirstContact, numRuns,
    ));

    results.push(await benchFlow(
      'Flow B: Cached invoke',
      'invoke with version hash (zero-schema)',
      harness, flowCachedInvoke, numRuns,
    ));

    results.push(await benchFlow(
      'Flow C: Streaming delegation',
      'delegate → SSE progress events → complete',
      harness, flowDelegate, numRuns, 10,
    ));

    results.push(await benchFlow(
      'Flow D: Context lifecycle',
      'share → request → revoke',
      harness, flowContext, numRuns,
    ));
  } finally {
    await harness.close();
  }

  return results;
}
