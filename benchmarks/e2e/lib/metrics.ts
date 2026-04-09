/**
 * Unified Metrics Collector
 *
 * Collects HDR histogram latency, event loop utilization, memory usage,
 * and GC pauses in a single coherent snapshot. Used by all E2E benchmarks.
 */

import { build as buildHistogram, type Histogram } from 'hdr-histogram-js';
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LatencySnapshot {
  count: number;
  min_ms: number;
  max_ms: number;
  mean_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  p999_ms: number;
  stddev_ms: number;
}

export interface MemorySnapshot {
  rss_mb: number;
  heap_used_mb: number;
  heap_total_mb: number;
  external_mb: number;
}

export interface MetricsSnapshot {
  latency: LatencySnapshot;
  memory_start: MemorySnapshot;
  memory_end: MemorySnapshot;
  memory_delta_mb: number;
  elu_pct: number;
  event_loop_p50_ms: number;
  event_loop_p99_ms: number;
  gc_pauses: number;
  duration_ms: number;
  throughput_rps: number;
}

// ---------------------------------------------------------------------------
// Metrics Collector
// ---------------------------------------------------------------------------

export class MetricsCollector {
  private histogram: Histogram;
  private eluMonitor: IntervalHistogram;
  private memStart: MemorySnapshot | null = null;
  private startTime = 0;
  private gcCount = 0;
  private gcObserver: PerformanceObserver | null = null;

  constructor() {
    this.histogram = buildHistogram({
      lowestDiscernibleValue: 1,        // 1 microsecond
      highestTrackableValue: 60_000_000, // 60 seconds in µs
      numberOfSignificantValueDigits: 3,
    });
    this.eluMonitor = monitorEventLoopDelay({ resolution: 10 });
  }

  /** Start collecting metrics */
  start(): void {
    this.histogram.reset();
    this.gcCount = 0;
    this.memStart = this.captureMemory();
    this.startTime = performance.now();
    this.eluMonitor.enable();

    // Track GC pauses
    try {
      this.gcObserver = new PerformanceObserver((list) => {
        this.gcCount += list.getEntries().length;
      });
      this.gcObserver.observe({ entryTypes: ['gc'] });
    } catch {
      // GC observation may not be available without --expose-gc
    }
  }

  /** Record a single latency measurement in microseconds */
  recordMicros(us: number): void {
    this.histogram.recordValue(Math.max(1, Math.round(us)));
  }

  /** Record a single latency measurement in milliseconds */
  recordMs(ms: number): void {
    this.recordMicros(ms * 1000);
  }

  /** Stop collecting and return snapshot */
  stop(): MetricsSnapshot {
    this.eluMonitor.disable();
    this.gcObserver?.disconnect();

    const durationMs = performance.now() - this.startTime;
    const memEnd = this.captureMemory();
    const count = this.histogram.totalCount;

    // Convert ELU histogram from nanoseconds to milliseconds
    const eluP50 = this.eluMonitor.percentile(50) / 1_000_000;
    const eluP99 = this.eluMonitor.percentile(99) / 1_000_000;
    // ELU as percentage: mean delay / resolution interval
    const eluMean = this.eluMonitor.mean / 1_000_000;
    const eluPct = Math.min(100, (eluMean / 10) * 100); // 10ms resolution

    return {
      latency: {
        count,
        min_ms: this.histogram.minNonZeroValue / 1000,
        max_ms: this.histogram.maxValue / 1000,
        mean_ms: this.histogram.mean / 1000,
        p50_ms: this.histogram.getValueAtPercentile(50) / 1000,
        p95_ms: this.histogram.getValueAtPercentile(95) / 1000,
        p99_ms: this.histogram.getValueAtPercentile(99) / 1000,
        p999_ms: this.histogram.getValueAtPercentile(99.9) / 1000,
        stddev_ms: this.histogram.stdDeviation / 1000,
      },
      memory_start: this.memStart!,
      memory_end: memEnd,
      memory_delta_mb: memEnd.rss_mb - this.memStart!.rss_mb,
      elu_pct: Math.round(eluPct * 10) / 10,
      event_loop_p50_ms: Math.round(eluP50 * 1000) / 1000,
      event_loop_p99_ms: Math.round(eluP99 * 1000) / 1000,
      gc_pauses: this.gcCount,
      duration_ms: Math.round(durationMs),
      throughput_rps: count > 0 ? Math.round((count / durationMs) * 1000) : 0,
    };
  }

  /** Reset for reuse */
  reset(): void {
    this.histogram.reset();
    this.gcCount = 0;
    this.memStart = null;
  }

  private captureMemory(): MemorySnapshot {
    const mem = process.memoryUsage();
    return {
      rss_mb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
      heap_used_mb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
      heap_total_mb: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
      external_mb: Math.round((mem.external / 1024 / 1024) * 10) / 10,
    };
  }
}
