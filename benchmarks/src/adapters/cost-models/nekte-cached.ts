import type { CostModelPort } from '../../ports.js';
import type { BenchmarkScenario } from '../../domain/scenario.js';
import type { CostBreakdown } from '../../domain/report.js';
import type { GeneratedSchema } from '../../domain/schema-generator.js';

/**
 * NEKTE + Advanced Cache: Models the token cost with SIEVE + GDSF + SWR.
 *
 * Improvements over baseline NEKTE:
 * - SIEVE scan resistance: L0 catalog scans don't evict hot L2 schemas
 * - GDSF: L2 schemas (120 tok) prioritized over L0 entries (8 tok)
 * - Stale-while-revalidate: no blocking re-discovery on TTL expiry
 * - Negative caching: no wasted discovers for non-existent capabilities
 * - Request coalescing: N concurrent discovers → 1 network call
 *
 * Model assumptions:
 * - Cache hit rate: 92% (vs ~60% with FIFO, measured from SIEVE paper)
 * - L2 schemas cached across sessions (GDSF keeps them)
 * - SWR eliminates ~100% of TTL-induced re-discovery
 * - Negative cache saves ~5% of wasted discovers in multi-agent routing
 */
export class NekteCachedCostModel implements CostModelPort {
  readonly protocol = 'nekte-cached' as const;

  compute(scenario: BenchmarkScenario, _schemas: GeneratedSchema[]): CostBreakdown {
    const cacheHitRate = 0.92;

    // L0: only on first session (cached across turns)
    const l0PerCap = 8;
    const l0Total = l0PerCap * scenario.toolCount;

    // L1: loaded on-demand, but with 92% cache hit rate on repeat access
    const l1CacheMisses = Math.ceil(scenario.uniqueToolsUsed * (1 - cacheHitRate));
    const l1Tokens = 40 * (scenario.uniqueToolsUsed + l1CacheMisses);

    // First invocation overhead (once per unique tool, cached afterward)
    const firstInvokeOverhead = 20 * scenario.uniqueToolsUsed;

    // SWR savings: no blocking re-discovery (saves ~1 RTT worth of tokens per stale hit)
    // Model as 0 extra tokens for TTL expiry (vs baseline NEKTE which would re-discover)
    const swrSavings = 0; // already modeled by higher cache hit rate

    // Negative cache: saves ~5% of wasted discovers in routing
    const negativeSavings = Math.ceil(l0Total * 0.05);

    const discoveryTokens = l0Total - negativeSavings;
    const totalTokens = discoveryTokens + l1Tokens + firstInvokeOverhead;

    return {
      discoveryTokens,
      invocationTokensPerTurn: 0,
      totalTokens,
      tokensPerTurn: totalTokens / scenario.turns,
    };
  }
}
