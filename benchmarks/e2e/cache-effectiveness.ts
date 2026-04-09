/**
 * Cache Effectiveness Benchmark
 *
 * Measures real cache hit rates under different access patterns:
 * - Zipfian (power-law): few hot capabilities, long cold tail
 * - Scan: sequential discovery of all capabilities (tests scan resistance)
 * - Temporal: popular capabilities shift over time
 *
 * Validates that SIEVE+GDSF actually outperforms LRU/FIFO with real data.
 */

import { SievePolicy } from '../../packages/core/dist/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CacheResult {
  pattern: string;
  description: string;
  total_requests: number;
  cache_size: number;
  key_space: number;
  hits: number;
  misses: number;
  hit_rate_pct: number;
  evictions: number;
}

// ---------------------------------------------------------------------------
// Access pattern generators
// ---------------------------------------------------------------------------

/** Zipfian distribution: P(k) ~ 1/k^s, where s=1.0 (standard Zipf) */
function zipfianAccess(keySpace: number, count: number, skew: number = 1.0): number[] {
  // Compute CDF for Zipfian
  const pmf: number[] = [];
  let sum = 0;
  for (let k = 1; k <= keySpace; k++) {
    const p = 1 / Math.pow(k, skew);
    pmf.push(p);
    sum += p;
  }
  // Normalize to CDF
  const cdf: number[] = [];
  let cumulative = 0;
  for (const p of pmf) {
    cumulative += p / sum;
    cdf.push(cumulative);
  }

  // Generate access sequence
  const sequence: number[] = [];
  for (let i = 0; i < count; i++) {
    const u = Math.random();
    let idx = cdf.findIndex((c) => c >= u);
    if (idx < 0) idx = keySpace - 1;
    sequence.push(idx);
  }
  return sequence;
}

/** Sequential scan: access every key in order, then repeat */
function scanAccess(keySpace: number, count: number): number[] {
  const sequence: number[] = [];
  for (let i = 0; i < count; i++) {
    sequence.push(i % keySpace);
  }
  return sequence;
}

/** Temporal: hot set shifts every `shiftInterval` accesses */
function temporalAccess(keySpace: number, count: number, hotSetSize: number = 10, shiftInterval: number = 1000): number[] {
  const sequence: number[] = [];
  let hotStart = 0;

  for (let i = 0; i < count; i++) {
    if (i > 0 && i % shiftInterval === 0) {
      hotStart = (hotStart + hotSetSize) % keySpace;
    }
    // 80% hot set, 20% random
    if (Math.random() < 0.8) {
      sequence.push(hotStart + Math.floor(Math.random() * hotSetSize));
    } else {
      sequence.push(Math.floor(Math.random() * keySpace));
    }
  }
  return sequence;
}

// ---------------------------------------------------------------------------
// Cache simulators
// ---------------------------------------------------------------------------

function simulateSieve(accessSequence: number[], cacheSize: number): { hits: number; misses: number; evictions: number } {
  const sieve = new SievePolicy<number>(cacheSize);
  const inCache = new Set<number>();
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  for (const key of accessSequence) {
    if (inCache.has(key)) {
      hits++;
      sieve.access(key);
    } else {
      misses++;
      if (inCache.size >= cacheSize) {
        const evicted = sieve.evict();
        if (evicted !== undefined) {
          inCache.delete(evicted);
          evictions++;
        }
      }
      sieve.insert(key);
      inCache.add(key);
    }
  }

  return { hits, misses, evictions };
}

function simulateLru(accessSequence: number[], cacheSize: number): { hits: number; misses: number; evictions: number } {
  const cache = new Map<number, boolean>(); // Map preserves insertion order
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  for (const key of accessSequence) {
    if (cache.has(key)) {
      hits++;
      // Move to end (most recent)
      cache.delete(key);
      cache.set(key, true);
    } else {
      misses++;
      if (cache.size >= cacheSize) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
        evictions++;
      }
      cache.set(key, true);
    }
  }

  return { hits, misses, evictions };
}

function simulateFifo(accessSequence: number[], cacheSize: number): { hits: number; misses: number; evictions: number } {
  const cache = new Set<number>();
  const queue: number[] = [];
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  for (const key of accessSequence) {
    if (cache.has(key)) {
      hits++;
    } else {
      misses++;
      if (cache.size >= cacheSize) {
        const evicted = queue.shift()!;
        cache.delete(evicted);
        evictions++;
      }
      cache.add(key);
      queue.push(key);
    }
  }

  return { hits, misses, evictions };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface CacheComparisonResult {
  pattern: string;
  description: string;
  key_space: number;
  cache_size: number;
  total_requests: number;
  sieve: CacheResult;
  lru: CacheResult;
  fifo: CacheResult;
}

export async function runCacheEffectiveness(): Promise<CacheComparisonResult[]> {
  const results: CacheComparisonResult[] = [];

  const configs = [
    {
      pattern: 'Zipfian (s=1.0)',
      description: '80/20 power-law — few hot capabilities, long cold tail',
      keySpace: 500,
      cacheSize: 100,
      requests: 50_000,
      generator: (ks: number, n: number) => zipfianAccess(ks, n, 1.0),
    },
    {
      pattern: 'Zipfian (s=0.7, mild skew)',
      description: 'Less concentrated popularity — harder for caches',
      keySpace: 500,
      cacheSize: 100,
      requests: 50_000,
      generator: (ks: number, n: number) => zipfianAccess(ks, n, 0.7),
    },
    {
      pattern: 'Sequential scan',
      description: 'Agent discovering all capabilities in order (scan resistance test)',
      keySpace: 500,
      cacheSize: 100,
      requests: 50_000,
      generator: scanAccess,
    },
    {
      pattern: 'Temporal shift',
      description: 'Hot capabilities change every 1000 requests (workflow evolution)',
      keySpace: 500,
      cacheSize: 100,
      requests: 50_000,
      generator: (ks: number, n: number) => temporalAccess(ks, n, 10, 1000),
    },
    {
      pattern: 'Zipfian (large keyspace)',
      description: '5000 capabilities, 1000 cache slots — enterprise scale',
      keySpace: 5000,
      cacheSize: 1000,
      requests: 100_000,
      generator: (ks: number, n: number) => zipfianAccess(ks, n, 1.0),
    },
  ];

  for (const cfg of configs) {
    const sequence = cfg.generator(cfg.keySpace, cfg.requests);

    const sieveResult = simulateSieve(sequence, cfg.cacheSize);
    const lruResult = simulateLru(sequence, cfg.cacheSize);
    const fifoResult = simulateFifo(sequence, cfg.cacheSize);

    const buildResult = (name: string, r: typeof sieveResult): CacheResult => ({
      pattern: name,
      description: cfg.description,
      total_requests: cfg.requests,
      cache_size: cfg.cacheSize,
      key_space: cfg.keySpace,
      hits: r.hits,
      misses: r.misses,
      hit_rate_pct: Math.round((r.hits / cfg.requests) * 10000) / 100,
      evictions: r.evictions,
    });

    results.push({
      pattern: cfg.pattern,
      description: cfg.description,
      key_space: cfg.keySpace,
      cache_size: cfg.cacheSize,
      total_requests: cfg.requests,
      sieve: buildResult('SIEVE', sieveResult),
      lru: buildResult('LRU', lruResult),
      fifo: buildResult('FIFO', fifoResult),
    });
  }

  return results;
}
