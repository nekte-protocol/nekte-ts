/**
 * Benchmark Runner — Orchestrates scenarios x cost models x renderers
 */

import type { BenchmarkScenario } from './domain/scenario.js';
import type { BenchmarkReport, BenchmarkResult, ProtocolId } from './domain/report.js';
import { generateSchemas } from './domain/schema-generator.js';
import type { CostModelPort, ReportRenderer } from './ports.js';

export interface BenchmarkRunnerConfig {
  scenarios: BenchmarkScenario[];
  costModels: CostModelPort[];
  renderers: ReportRenderer[];
  seed?: number;
  costPerMTok?: number;
}

export class BenchmarkRunner {
  private config: BenchmarkRunnerConfig;

  constructor(config: BenchmarkRunnerConfig) {
    this.config = config;
  }

  run(): BenchmarkReport {
    const seed = this.config.seed ?? 42;
    const results: BenchmarkResult[] = [];

    for (const scenario of this.config.scenarios) {
      const schemas = generateSchemas(scenario.toolCount, scenario.schemaComplexity, seed);
      const costs: Partial<Record<ProtocolId, ReturnType<CostModelPort['compute']>>> = {};

      for (const model of this.config.costModels) {
        costs[model.protocol] = model.compute(scenario, schemas);
      }

      results.push({ scenario, costs });
    }

    const report: BenchmarkReport = {
      timestamp: new Date().toISOString(),
      version: '0.2.0',
      seed,
      scenarios: results,
      costPerMTok: this.config.costPerMTok ?? 3,
    };

    for (const renderer of this.config.renderers) {
      renderer.render(report);
    }

    return report;
  }
}
