/**
 * Transport Throughput Benchmark
 *
 * Measures req/s and latency distribution (P50/P95/P99) for each
 * NEKTE protocol primitive over HTTP. Uses open-loop scheduling
 * to avoid coordinated omission.
 *
 * Compared against published MCP Node.js numbers:
 *   MCP: 559 RPS, 10.66ms avg, 53.24ms P95 (TM Dev Lab, Feb 2026)
 */

import { createHarness, type Harness } from './lib/harness.js';
import { MetricsCollector, type MetricsSnapshot } from './lib/metrics.js';
import { generateSchedule, executeSchedule, type WorkloadConfig } from './lib/workload.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface BenchConfig {
  /** Requests per second */
  rate: number;
  /** Duration in seconds */
  durationSec: number;
  /** Warmup duration in seconds */
  warmupSec: number;
  /** Number of capabilities */
  capCount: number;
  /** Handler latency in ms */
  handlerMs: number;
}

const DEFAULT: BenchConfig = {
  rate: 500,
  durationSec: 5,
  warmupSec: 2,
  capCount: 30,
  handlerMs: 1,
};

// ---------------------------------------------------------------------------
// Benchmark scenarios
// ---------------------------------------------------------------------------

async function benchDiscover(harness: Harness, config: BenchConfig): Promise<MetricsSnapshot> {
  const metrics = new MetricsCollector();

  // Warmup
  const warmup = generateSchedule({ pattern: 'constant', rate: config.rate, durationMs: config.warmupSec * 1000 });
  await executeSchedule(warmup, async () => {
    await harness.client.catalog();
  });

  // Measured run
  const schedule = generateSchedule({ pattern: 'constant', rate: config.rate, durationMs: config.durationSec * 1000 });
  metrics.start();

  const result = await executeSchedule(schedule, async () => {
    await harness.client.catalog();
  });

  // Record latencies from CO-corrected measurements
  for (let i = 0; i < result.latencies.length; i++) {
    if (result.latencies[i] > 0) metrics.recordMicros(result.latencies[i]);
  }

  const snapshot = metrics.stop();
  return snapshot;
}

async function benchDiscoverL2(harness: Harness, config: BenchConfig): Promise<MetricsSnapshot> {
  const metrics = new MetricsCollector();

  const warmup = generateSchedule({ pattern: 'constant', rate: config.rate, durationMs: config.warmupSec * 1000 });
  await executeSchedule(warmup, async () => {
    await harness.client.discover({ level: 2 });
  });

  const schedule = generateSchedule({ pattern: 'constant', rate: config.rate, durationMs: config.durationSec * 1000 });
  metrics.start();

  const result = await executeSchedule(schedule, async () => {
    await harness.client.discover({ level: 2 });
  });

  for (let i = 0; i < result.latencies.length; i++) {
    if (result.latencies[i] > 0) metrics.recordMicros(result.latencies[i]);
  }

  return metrics.stop();
}

async function benchInvoke(harness: Harness, config: BenchConfig): Promise<MetricsSnapshot> {
  const metrics = new MetricsCollector();
  const capId = harness.capIds[0];

  // Warmup
  const warmup = generateSchedule({ pattern: 'constant', rate: config.rate, durationMs: config.warmupSec * 1000 });
  await executeSchedule(warmup, async () => {
    await harness.client.invoke(capId, { input: { query: 'benchmark test', limit: 5 } });
  });

  const schedule = generateSchedule({ pattern: 'constant', rate: config.rate, durationMs: config.durationSec * 1000 });
  metrics.start();

  const result = await executeSchedule(schedule, async () => {
    await harness.client.invoke(capId, { input: { query: 'benchmark test', limit: 5 } });
  });

  for (let i = 0; i < result.latencies.length; i++) {
    if (result.latencies[i] > 0) metrics.recordMicros(result.latencies[i]);
  }

  return metrics.stop();
}

async function benchInvokeCached(harness: Harness, config: BenchConfig): Promise<MetricsSnapshot> {
  const metrics = new MetricsCollector();
  const capId = harness.capIds[0];

  // Warm the client cache so invoke uses cached hash
  await harness.client.schema(capId);

  const warmup = generateSchedule({ pattern: 'constant', rate: config.rate, durationMs: config.warmupSec * 1000 });
  await executeSchedule(warmup, async () => {
    await harness.client.invoke(capId, { input: { query: 'benchmark test' } });
  });

  const schedule = generateSchedule({ pattern: 'constant', rate: config.rate, durationMs: config.durationSec * 1000 });
  metrics.start();

  const result = await executeSchedule(schedule, async () => {
    await harness.client.invoke(capId, { input: { query: 'benchmark test' } });
  });

  for (let i = 0; i < result.latencies.length; i++) {
    if (result.latencies[i] > 0) metrics.recordMicros(result.latencies[i]);
  }

  return metrics.stop();
}

async function benchTaskCancel(harness: Harness, config: BenchConfig): Promise<MetricsSnapshot> {
  const metrics = new MetricsCollector();

  // For cancel we need to register + cancel tasks
  const schedule = generateSchedule({ pattern: 'constant', rate: Math.min(config.rate, 200), durationMs: config.durationSec * 1000 });
  metrics.start();

  const result = await executeSchedule(schedule, async (i) => {
    const taskId = `cancel-bench-${i}`;
    // Register a task then immediately cancel it
    harness.server.tasks.register({ id: taskId, desc: 'bench', cap: harness.capIds[0] });
    harness.server.tasks.transition(taskId, 'accepted');
    harness.server.tasks.transition(taskId, 'running');
    harness.server.tasks.cancel(taskId, 'benchmark');
  });

  for (let i = 0; i < result.latencies.length; i++) {
    if (result.latencies[i] > 0) metrics.recordMicros(result.latencies[i]);
  }

  return metrics.stop();
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runTransportThroughput(overrides?: Partial<BenchConfig>): Promise<Map<string, MetricsSnapshot>> {
  const config = { ...DEFAULT, ...overrides };
  const results = new Map<string, MetricsSnapshot>();

  const harness = await createHarness({
    capCount: config.capCount,
    handlerLatencyMs: config.handlerMs,
  });

  try {
    const benchmarks: Array<[string, () => Promise<MetricsSnapshot>]> = [
      ['nekte.discover L0 (HTTP)', () => benchDiscover(harness, config)],
      ['nekte.discover L2 (HTTP)', () => benchDiscoverL2(harness, config)],
      ['nekte.invoke (HTTP)', () => benchInvoke(harness, config)],
      ['nekte.invoke cached hash (HTTP)', () => benchInvokeCached(harness, config)],
      ['nekte.task lifecycle (in-process)', () => benchTaskCancel(harness, config)],
    ];

    for (const [name, fn] of benchmarks) {
      results.set(name, await fn());
    }
  } finally {
    await harness.close();
  }

  return results;
}
