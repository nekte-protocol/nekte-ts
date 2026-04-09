/**
 * Benchmark Ports — Hexagonal Architecture
 */

import type { BenchmarkScenario } from './domain/scenario.js';
import type { BenchmarkReport, CostBreakdown, ProtocolId } from './domain/report.js';
import type { GeneratedSchema } from './domain/schema-generator.js';

/** Port: computes token cost for a protocol */
export interface CostModelPort {
  readonly protocol: ProtocolId;
  compute(scenario: BenchmarkScenario, schemas: GeneratedSchema[]): CostBreakdown;
}

/** Port: renders a benchmark report */
export interface ReportRenderer {
  render(report: BenchmarkReport): string | void;
}
