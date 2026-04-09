/**
 * Benchmark Scenarios — Domain Value Objects
 */

export type SchemaComplexity = 'simple' | 'medium' | 'complex';

export interface BenchmarkScenario {
  name: string;
  toolCount: number;
  turns: number;
  toolsUsedPerTurn: number;
  uniqueToolsUsed: number;
  schemaComplexity: SchemaComplexity;
}

/** Built-in scenario presets */
export const DEFAULT_SCENARIOS: BenchmarkScenario[] = [
  { name: 'Simple chat', toolCount: 5, turns: 5, toolsUsedPerTurn: 1, uniqueToolsUsed: 2, schemaComplexity: 'simple' },
  { name: 'Dev workflow', toolCount: 15, turns: 10, toolsUsedPerTurn: 1, uniqueToolsUsed: 4, schemaComplexity: 'medium' },
  { name: 'Medium agent', toolCount: 30, turns: 15, toolsUsedPerTurn: 1, uniqueToolsUsed: 6, schemaComplexity: 'medium' },
  { name: 'Enterprise', toolCount: 50, turns: 20, toolsUsedPerTurn: 1, uniqueToolsUsed: 8, schemaComplexity: 'complex' },
  { name: 'Platform', toolCount: 100, turns: 25, toolsUsedPerTurn: 1, uniqueToolsUsed: 10, schemaComplexity: 'complex' },
  { name: 'Mega', toolCount: 200, turns: 30, toolsUsedPerTurn: 1, uniqueToolsUsed: 12, schemaComplexity: 'complex' },
];
