import type { CostModelPort } from '../../ports.js';
import type { BenchmarkScenario } from '../../domain/scenario.js';
import type { CostBreakdown } from '../../domain/report.js';
import type { GeneratedSchema } from '../../domain/schema-generator.js';
import { estimateSchemaTokens } from '../../domain/schema-generator.js';

/** MCP Native: all tool schemas serialized every turn */
export class McpNativeCostModel implements CostModelPort {
  readonly protocol = 'mcp-native' as const;

  compute(scenario: BenchmarkScenario, schemas: GeneratedSchema[]): CostBreakdown {
    const schemaTokensPerTool = schemas.reduce((sum, s) => sum + estimateSchemaTokens(s), 0) / schemas.length;
    const totalSchemaTokens = schemaTokensPerTool * scenario.toolCount;

    // MCP sends ALL schemas every turn
    const discoveryTokens = totalSchemaTokens; // first turn
    const invocationTokensPerTurn = totalSchemaTokens; // every subsequent turn too
    const totalTokens = totalSchemaTokens * scenario.turns;

    return {
      discoveryTokens,
      invocationTokensPerTurn,
      totalTokens,
      tokensPerTurn: totalTokens / scenario.turns,
    };
  }
}
