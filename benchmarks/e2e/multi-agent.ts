/**
 * Multi-Agent Concurrency Benchmark
 *
 * Simulates N concurrent agents hitting the same NekteServer.
 * Measures contention effects: latency degradation, throughput scaling,
 * and cache sharing benefits.
 */

import { createHarness, type Harness } from './lib/harness.js';
import { MetricsCollector, type MetricsSnapshot } from './lib/metrics.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentWorkload {
  /** Agent identifier */
  agentId: string;
  /** Capabilities this agent discovers/invokes */
  capIds: string[];
  /** Requests per second per agent */
  rate: number;
  /** Duration in ms */
  durationMs: number;
}

export interface MultiAgentResult {
  agent_count: number;
  total_requests: number;
  total_completed: number;
  total_failed: number;
  latency: MetricsSnapshot;
  per_agent_rps: number;
  aggregate_rps: number;
}

// ---------------------------------------------------------------------------
// Single agent simulation
// ---------------------------------------------------------------------------

async function simulateAgent(
  harness: Harness,
  workload: AgentWorkload,
  metrics: MetricsCollector,
): Promise<{ completed: number; failed: number }> {
  const intervalMs = 1000 / workload.rate;
  const endTime = performance.now() + workload.durationMs;
  let completed = 0;
  let failed = 0;
  let requestIdx = 0;

  const actions = ['discover', 'invoke', 'invoke', 'invoke', 'invoke', 'discover', 'invoke', 'invoke', 'invoke', 'invoke'] as const;

  while (performance.now() < endTime) {
    const scheduledTime = performance.now();
    const action = actions[requestIdx % actions.length];
    const capId = workload.capIds[requestIdx % workload.capIds.length];

    try {
      if (action === 'discover') {
        await harness.client.catalog();
      } else {
        await harness.client.invoke(capId, { input: { query: `agent-${workload.agentId}-req-${requestIdx}` } });
      }
      const latencyUs = (performance.now() - scheduledTime) * 1000;
      metrics.recordMicros(latencyUs);
      completed++;
    } catch {
      failed++;
    }

    requestIdx++;

    // Open-loop: wait for next scheduled time
    const elapsed = performance.now() - scheduledTime;
    const wait = intervalMs - elapsed;
    if (wait > 1) await new Promise((r) => setTimeout(r, wait));
  }

  return { completed, failed };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runMultiAgent(
  agentCounts?: number[],
): Promise<MultiAgentResult[]> {
  const counts = agentCounts ?? [1, 5, 10, 20];
  const results: MultiAgentResult[] = [];

  const harness = await createHarness({
    capCount: 30,
    handlerLatencyMs: 1,
  });

  const perAgentRate = 50; // req/s per agent
  const durationMs = 5_000;

  try {
    for (const agentCount of counts) {
      // Pause between runs
      if (results.length > 0) await new Promise((r) => setTimeout(r, 1000));

      const metrics = new MetricsCollector();
      metrics.start();

      // Create overlapping workloads (agents share some capabilities)
      const workloads: AgentWorkload[] = Array.from({ length: agentCount }, (_, i) => ({
        agentId: `agent-${i}`,
        capIds: harness.capIds.slice(
          (i * 5) % harness.capIds.length,
          ((i * 5) % harness.capIds.length) + 10,
        ),
        rate: perAgentRate,
        durationMs,
      }));

      // Launch all agents concurrently
      const agentResults = await Promise.all(
        workloads.map((w) => simulateAgent(harness, w, metrics)),
      );

      const snapshot = metrics.stop();

      let totalCompleted = 0;
      let totalFailed = 0;
      for (const r of agentResults) {
        totalCompleted += r.completed;
        totalFailed += r.failed;
      }

      results.push({
        agent_count: agentCount,
        total_requests: totalCompleted + totalFailed,
        total_completed: totalCompleted,
        total_failed: totalFailed,
        latency: snapshot,
        per_agent_rps: Math.round(totalCompleted / agentCount / (durationMs / 1000)),
        aggregate_rps: Math.round(totalCompleted / (durationMs / 1000)),
      });
    }
  } finally {
    await harness.close();
  }

  return results;
}
