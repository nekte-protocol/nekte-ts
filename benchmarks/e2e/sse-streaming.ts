/**
 * SSE Streaming Benchmark
 *
 * Measures delegate stream performance:
 * - Time to First Event (TTFE)
 * - Inter-event latency
 * - Connection scaling (memory per stream)
 * - Concurrent stream throughput
 */

import { createHarness, type Harness } from './lib/harness.js';
import { MetricsCollector, type MetricsSnapshot } from './lib/metrics.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StreamingResult {
  concurrency: number;
  ttfe: MetricsSnapshot;
  inter_event: MetricsSnapshot;
  total_events: number;
  memory_per_stream_kb: number;
  streams_completed: number;
  streams_failed: number;
}

// ---------------------------------------------------------------------------
// Single stream measurement
// ---------------------------------------------------------------------------

async function measureStream(
  endpoint: string,
  taskId: string,
  capId: string,
  ttfeMetrics: MetricsCollector,
  interEventMetrics: MetricsCollector,
): Promise<{ events: number; ok: boolean }> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    method: 'nekte.delegate',
    id: 1,
    params: {
      task: { id: taskId, desc: 'Benchmark streaming', cap: capId },
      context: undefined,
    },
  });

  const requestStart = performance.now();
  let firstEventTime = 0;
  let lastEventTime = 0;
  let eventCount = 0;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!res.body) return { events: 0, ok: false };

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
        const now = performance.now();
        eventCount++;

        if (eventCount === 1) {
          firstEventTime = now;
          ttfeMetrics.recordMicros((now - requestStart) * 1000);
        } else {
          interEventMetrics.recordMicros((now - lastEventTime) * 1000);
        }
        lastEventTime = now;
      }
    }

    return { events: eventCount, ok: true };
  } catch {
    return { events: eventCount, ok: false };
  }
}

// ---------------------------------------------------------------------------
// Concurrent streaming benchmark
// ---------------------------------------------------------------------------

async function benchStreaming(
  harness: Harness,
  concurrency: number,
): Promise<StreamingResult> {
  const ttfeMetrics = new MetricsCollector();
  const interEventMetrics = new MetricsCollector();

  const memBefore = process.memoryUsage();

  ttfeMetrics.start();
  interEventMetrics.start();

  // Launch N concurrent delegate streams
  const promises = Array.from({ length: concurrency }, (_, i) =>
    measureStream(
      harness.endpoint,
      `stream-bench-${i}-${Date.now()}`,
      harness.capIds[i % harness.capIds.length],
      ttfeMetrics,
      interEventMetrics,
    ),
  );

  const results = await Promise.allSettled(promises);

  const ttfeSnapshot = ttfeMetrics.stop();
  const interEventSnapshot = interEventMetrics.stop();
  const memAfter = process.memoryUsage();

  let completed = 0;
  let failed = 0;
  let totalEvents = 0;

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.ok) {
      completed++;
      totalEvents += r.value.events;
    } else {
      failed++;
    }
  }

  const memDeltaKb = (memAfter.rss - memBefore.rss) / 1024;
  const memPerStream = concurrency > 0 ? memDeltaKb / concurrency : 0;

  return {
    concurrency,
    ttfe: ttfeSnapshot,
    inter_event: interEventSnapshot,
    total_events: totalEvents,
    memory_per_stream_kb: Math.round(memPerStream * 10) / 10,
    streams_completed: completed,
    streams_failed: failed,
  };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runSseStreaming(
  concurrencyLevels?: number[],
): Promise<StreamingResult[]> {
  const levels = concurrencyLevels ?? [1, 10, 50, 100];
  const results: StreamingResult[] = [];

  const harness = await createHarness({
    capCount: 30,
    handlerLatencyMs: 2, // Slightly slower to produce realistic streams
  });

  try {
    for (const concurrency of levels) {
      // Small pause between levels to let GC settle
      if (results.length > 0) await new Promise((r) => setTimeout(r, 500));
      results.push(await benchStreaming(harness, concurrency));
    }
  } finally {
    await harness.close();
  }

  return results;
}
