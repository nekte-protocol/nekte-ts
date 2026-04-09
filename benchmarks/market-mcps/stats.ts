/**
 * Statistical Utilities
 *
 * Computes descriptive statistics with proper methodology:
 * - Warm-up runs discarded before measurement
 * - Percentile calculation via linear interpolation
 * - Standard deviation (population, not sample — we control all runs)
 */

import type { Stats } from './types.js';

export function computeStats(values: number[]): Stats {
  if (values.length === 0) {
    return { mean: 0, median: 0, p5: 0, p95: 0, stddev: 0, min: 0, max: 0, n: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;

  return {
    mean: round(mean),
    median: round(percentile(sorted, 50)),
    p5: round(percentile(sorted, 5)),
    p95: round(percentile(sorted, 95)),
    stddev: round(Math.sqrt(variance)),
    min: sorted[0],
    max: sorted[n - 1],
    n,
  };
}

/** Linear interpolation percentile */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Coefficient of variation (relative stddev) */
export function cv(stats: Stats): number {
  if (stats.mean === 0) return 0;
  return round((stats.stddev / stats.mean) * 100);
}
