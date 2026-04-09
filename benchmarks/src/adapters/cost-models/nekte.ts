import type { CostModelPort } from '../../ports.js';
import type { BenchmarkScenario } from '../../domain/scenario.js';
import type { CostBreakdown } from '../../domain/report.js';
import type { GeneratedSchema } from '../../domain/schema-generator.js';

/** NEKTE: L0 catalog + L1 on-demand + zero-schema invocation */
export class NekteCostModel implements CostModelPort {
  readonly protocol = 'nekte' as const;

  compute(scenario: BenchmarkScenario, schemas: GeneratedSchema[]): CostBreakdown {
    // L0: ~8 tokens per capability (id + cat + hash)
    const l0PerCap = 8;
    const l0Total = l0PerCap * scenario.toolCount;

    // L1: ~40 tokens per capability, loaded on-demand for used tools
    const l1Tokens = 40 * scenario.uniqueToolsUsed;

    // First invocation per unique tool: ~20 tokens overhead (budget + response meta)
    // Subsequent invocations: 0 overhead (zero-schema via hash)
    const firstInvokeOverhead = 20 * scenario.uniqueToolsUsed;
    const subsequentInvokes = scenario.turns - scenario.uniqueToolsUsed;

    // Discovery: L0 catalog (once)
    const discoveryTokens = l0Total;

    // Total: L0 once + L1 on-demand + first invoke overhead
    const totalTokens = l0Total + l1Tokens + firstInvokeOverhead;

    return {
      discoveryTokens,
      invocationTokensPerTurn: 0, // zero-schema after first call
      totalTokens,
      tokensPerTurn: totalTokens / scenario.turns,
    };
  }
}
