import type { CostModelPort } from '../../ports.js';
import type { BenchmarkScenario } from '../../domain/scenario.js';
import type { CostBreakdown } from '../../domain/report.js';
import type { GeneratedSchema } from '../../domain/schema-generator.js';
import { estimateSchemaTokens } from '../../domain/schema-generator.js';

/** mcp2cli: tool list once, full schema on first use per tool */
export class Mcp2CliCostModel implements CostModelPort {
  readonly protocol = 'mcp2cli' as const;

  compute(scenario: BenchmarkScenario, schemas: GeneratedSchema[]): CostBreakdown {
    // --list: ~16 tokens per tool (name only)
    const listPerTool = 16;
    const listTotal = listPerTool * scenario.toolCount;

    // --help: full schema loaded once per unique tool used
    const avgSchemaTokens = schemas.reduce((sum, s) => sum + estimateSchemaTokens(s), 0) / schemas.length;
    const helpTokens = avgSchemaTokens * scenario.uniqueToolsUsed;

    // Discovery: one --list call
    const discoveryTokens = listTotal;

    // Invocations: help schemas loaded once, no re-loading
    const invocationTokensPerTurn = 0; // after first load, no overhead
    const totalTokens = listTotal + helpTokens;

    return {
      discoveryTokens,
      invocationTokensPerTurn,
      totalTokens,
      tokensPerTurn: totalTokens / scenario.turns,
    };
  }
}
