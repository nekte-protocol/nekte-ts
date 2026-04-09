import { describe, it, expect } from 'vitest';
import { generateSchemas, estimateSchemaTokens } from '../domain/schema-generator.js';
import { DEFAULT_SCENARIOS } from '../domain/scenario.js';
import { McpNativeCostModel } from '../adapters/cost-models/mcp-native.js';
import { McpProgressiveCostModel } from '../adapters/cost-models/mcp-progressive.js';
import { Mcp2CliCostModel } from '../adapters/cost-models/mcp2cli.js';
import { NekteCostModel } from '../adapters/cost-models/nekte.js';
import { BenchmarkRunner } from '../runner.js';

describe('DeterministicSchemaGenerator', () => {
  it('generates deterministic schemas with same seed', () => {
    const a = generateSchemas(10, 'medium', 42);
    const b = generateSchemas(10, 'medium', 42);
    expect(a).toEqual(b);
  });

  it('generates different schemas with different seeds', () => {
    const a = generateSchemas(5, 'simple', 1);
    const b = generateSchemas(5, 'simple', 2);
    expect(a).not.toEqual(b);
  });

  it('respects complexity levels', () => {
    const simple = generateSchemas(3, 'simple', 42);
    const complex = generateSchemas(3, 'complex', 42);

    const simpleTokens = simple.reduce((s, schema) => s + estimateSchemaTokens(schema), 0) / simple.length;
    const complexTokens = complex.reduce((s, schema) => s + estimateSchemaTokens(schema), 0) / complex.length;

    expect(complexTokens).toBeGreaterThan(simpleTokens);
  });

  it('generates the requested count', () => {
    expect(generateSchemas(50, 'medium', 42)).toHaveLength(50);
  });
});

describe('Cost Models', () => {
  const schemas = generateSchemas(50, 'complex', 42);
  const scenario = DEFAULT_SCENARIOS[3]; // Enterprise: 50 tools, 20 turns

  it('MCP native costs more than all others', () => {
    const mcp = new McpNativeCostModel().compute(scenario, schemas);
    const progressive = new McpProgressiveCostModel().compute(scenario, schemas);
    const mcp2cli = new Mcp2CliCostModel().compute(scenario, schemas);
    const nekte = new NekteCostModel().compute(scenario, schemas);

    expect(mcp.totalTokens).toBeGreaterThan(progressive.totalTokens);
    expect(mcp.totalTokens).toBeGreaterThan(mcp2cli.totalTokens);
    expect(mcp.totalTokens).toBeGreaterThan(nekte.totalTokens);
  });

  it('NEKTE costs less than mcp2cli', () => {
    const mcp2cli = new Mcp2CliCostModel().compute(scenario, schemas);
    const nekte = new NekteCostModel().compute(scenario, schemas);
    expect(nekte.totalTokens).toBeLessThan(mcp2cli.totalTokens);
  });

  it('all cost models return positive values', () => {
    const models = [new McpNativeCostModel(), new McpProgressiveCostModel(), new Mcp2CliCostModel(), new NekteCostModel()];
    for (const model of models) {
      const cost = model.compute(scenario, schemas);
      expect(cost.totalTokens).toBeGreaterThan(0);
      expect(cost.discoveryTokens).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('BenchmarkRunner', () => {
  it('produces a report with all scenarios', () => {
    const report = new BenchmarkRunner({
      scenarios: DEFAULT_SCENARIOS.slice(0, 2), // just first two for speed
      costModels: [new McpNativeCostModel(), new NekteCostModel()],
      renderers: [], // no output during tests
      seed: 42,
    }).run();

    expect(report.scenarios).toHaveLength(2);
    expect(report.seed).toBe(42);
    expect(report.scenarios[0].costs['mcp-native']).toBeDefined();
    expect(report.scenarios[0].costs['nekte']).toBeDefined();
  });
});
