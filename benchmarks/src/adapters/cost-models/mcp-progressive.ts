import type { CostModelPort } from '../../ports.js';
import type { BenchmarkScenario } from '../../domain/scenario.js';
import type { CostBreakdown } from '../../domain/report.js';
import type { GeneratedSchema } from '../../domain/schema-generator.js';
import { estimateSchemaTokens } from '../../domain/schema-generator.js';

/** MCP with Progressive Disclosure: metadata always, full schema on-demand */
export class McpProgressiveCostModel implements CostModelPort {
  readonly protocol = 'mcp-progressive' as const;

  compute(scenario: BenchmarkScenario, schemas: GeneratedSchema[]): CostBreakdown {
    // Metadata per tool: ~15 tokens (name + short description)
    const metadataPerTool = 15;
    const metadataTotal = metadataPerTool * scenario.toolCount;

    // Full schema loaded on-demand per unique tool used
    const avgSchemaTokens = schemas.reduce((sum, s) => sum + estimateSchemaTokens(s), 0) / schemas.length;
    const onDemandTokens = avgSchemaTokens * scenario.uniqueToolsUsed;

    // Discovery: metadata for all tools (once)
    const discoveryTokens = metadataTotal;

    // Per turn: metadata always loaded + amortized on-demand
    const invocationTokensPerTurn = metadataTotal;

    // Total: metadata every turn + on-demand schemas once
    const totalTokens = metadataTotal * scenario.turns + onDemandTokens;

    return {
      discoveryTokens,
      invocationTokensPerTurn,
      totalTokens,
      tokensPerTurn: totalTokens / scenario.turns,
    };
  }
}
