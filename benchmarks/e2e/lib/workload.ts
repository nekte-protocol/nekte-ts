/**
 * Workload Generator
 *
 * Generates realistic request arrival patterns for load testing.
 * Supports constant rate, Poisson arrivals, and burst patterns.
 * All generators are open-loop: requests are scheduled at fixed times
 * regardless of response completion (avoids coordinated omission).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkloadPattern = 'constant' | 'poisson' | 'burst' | 'ramp';

export interface WorkloadConfig {
  pattern: WorkloadPattern;
  /** Target requests per second */
  rate: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** For burst: baseline rate (between bursts) */
  burstBaseRate?: number;
  /** For burst: interval between bursts in ms */
  burstIntervalMs?: number;
  /** For burst: duration of each burst in ms */
  burstDurationMs?: number;
  /** For ramp: starting rate */
  rampStartRate?: number;
}

export interface ScheduledRequest {
  /** Time offset in ms from start when this request should fire */
  scheduledAt: number;
  /** Sequential request index */
  index: number;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Generate a schedule of request arrival times.
 * Returns an array of timestamps (ms from start) when each request should fire.
 * Open-loop: timestamps are fixed regardless of response times.
 */
export function generateSchedule(config: WorkloadConfig): ScheduledRequest[] {
  switch (config.pattern) {
    case 'constant':
      return constantRate(config.rate, config.durationMs);
    case 'poisson':
      return poissonArrivals(config.rate, config.durationMs);
    case 'burst':
      return burstPattern(config);
    case 'ramp':
      return rampUp(config);
    default:
      throw new Error(`Unknown workload pattern: ${config.pattern}`);
  }
}

/** Constant rate: exactly `rate` requests per second, evenly spaced */
function constantRate(rate: number, durationMs: number): ScheduledRequest[] {
  const intervalMs = 1000 / rate;
  const schedule: ScheduledRequest[] = [];
  let t = 0;
  let i = 0;
  while (t < durationMs) {
    schedule.push({ scheduledAt: t, index: i++ });
    t += intervalMs;
  }
  return schedule;
}

/** Poisson arrivals: exponentially distributed inter-arrival times */
function poissonArrivals(rate: number, durationMs: number): ScheduledRequest[] {
  const schedule: ScheduledRequest[] = [];
  let t = 0;
  let i = 0;
  while (t < durationMs) {
    schedule.push({ scheduledAt: t, index: i++ });
    // Exponential inter-arrival: -ln(U) / λ where λ = rate/1000 (per ms)
    const u = Math.random();
    t += -Math.log(u) / (rate / 1000);
  }
  return schedule;
}

/** Burst: low baseline with periodic high-rate bursts */
function burstPattern(config: WorkloadConfig): ScheduledRequest[] {
  const baseRate = config.burstBaseRate ?? config.rate * 0.1;
  const burstRate = config.rate;
  const burstInterval = config.burstIntervalMs ?? 10_000;
  const burstDuration = config.burstDurationMs ?? 2_000;

  const schedule: ScheduledRequest[] = [];
  let t = 0;
  let i = 0;

  while (t < config.durationMs) {
    // Determine if we're in a burst window
    const cyclePos = t % burstInterval;
    const inBurst = cyclePos < burstDuration;
    const rate = inBurst ? burstRate : baseRate;
    const intervalMs = 1000 / rate;

    schedule.push({ scheduledAt: t, index: i++ });
    t += intervalMs;
  }
  return schedule;
}

/** Ramp: linearly increase rate from startRate to rate over duration */
function rampUp(config: WorkloadConfig): ScheduledRequest[] {
  const startRate = config.rampStartRate ?? 1;
  const endRate = config.rate;
  const schedule: ScheduledRequest[] = [];
  let t = 0;
  let i = 0;

  while (t < config.durationMs) {
    const progress = t / config.durationMs;
    const currentRate = startRate + (endRate - startRate) * progress;
    const intervalMs = 1000 / currentRate;

    schedule.push({ scheduledAt: t, index: i++ });
    t += intervalMs;
  }
  return schedule;
}

// ---------------------------------------------------------------------------
// Open-loop executor
// ---------------------------------------------------------------------------

export interface ExecutorResult {
  completed: number;
  failed: number;
  /** Latencies in microseconds, aligned with schedule index */
  latencies: Float64Array;
}

/**
 * Execute a workload schedule against an async task function.
 * Open-loop: requests fire at scheduled times regardless of completion.
 * Measures latency from SCHEDULED time (not actual send time) to avoid
 * coordinated omission.
 */
export async function executeSchedule(
  schedule: ScheduledRequest[],
  task: (index: number) => Promise<void>,
): Promise<ExecutorResult> {
  const latencies = new Float64Array(schedule.length);
  let completed = 0;
  let failed = 0;

  const startTime = performance.now();
  const promises: Promise<void>[] = [];

  for (const req of schedule) {
    const now = performance.now() - startTime;
    const delay = req.scheduledAt - now;

    if (delay > 1) {
      await new Promise((r) => setTimeout(r, delay));
    }

    const scheduledTime = startTime + req.scheduledAt;
    const p = task(req.index)
      .then(() => {
        const endTime = performance.now();
        // Latency from SCHEDULED time, not actual send time (CO correction)
        latencies[req.index] = (endTime - scheduledTime) * 1000; // µs
        completed++;
      })
      .catch(() => {
        latencies[req.index] = -1;
        failed++;
      });

    promises.push(p);
  }

  // Wait for all in-flight requests to complete
  await Promise.allSettled(promises);

  return { completed, failed, latencies };
}
