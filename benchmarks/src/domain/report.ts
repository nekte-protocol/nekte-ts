/**
 * Benchmark Report — Domain Aggregates
 */

import type { BenchmarkScenario } from './scenario.js';

export type ProtocolId = 'mcp-native' | 'mcp-progressive' | 'mcp2cli' | 'nekte' | 'nekte-cached';

export interface CostBreakdown {
  discoveryTokens: number;
  invocationTokensPerTurn: number;
  totalTokens: number;
  tokensPerTurn: number;
}

export interface BenchmarkResult {
  scenario: BenchmarkScenario;
  costs: Partial<Record<ProtocolId, CostBreakdown>>;
}

export interface BenchmarkReport {
  timestamp: string;
  version: string;
  seed: number;
  scenarios: BenchmarkResult[];
  costPerMTok: number;
}
