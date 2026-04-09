#!/usr/bin/env node
/**
 * Benchmark CLI — Entry point
 *
 * Usage:
 *   pnpm benchmark                          # default scenarios, terminal output
 *   pnpm benchmark --format json --out results/
 *   pnpm benchmark --format terminal,json,markdown --out results/
 *   pnpm benchmark --tools 50 --turns 20 --used 8 --complexity complex
 */

import { DEFAULT_SCENARIOS, type BenchmarkScenario } from './domain/scenario.js';
import { McpNativeCostModel } from './adapters/cost-models/mcp-native.js';
import { McpProgressiveCostModel } from './adapters/cost-models/mcp-progressive.js';
import { Mcp2CliCostModel } from './adapters/cost-models/mcp2cli.js';
import { NekteCostModel } from './adapters/cost-models/nekte.js';
import { NekteCachedCostModel } from './adapters/cost-models/nekte-cached.js';
import { TerminalTableRenderer } from './adapters/renderers/terminal.js';
import { JsonReportRenderer } from './adapters/renderers/json.js';
import { MarkdownReportRenderer } from './adapters/renderers/markdown.js';
import { BenchmarkRunner } from './runner.js';
import type { ReportRenderer } from './ports.js';
import type { SchemaComplexity } from './domain/scenario.js';

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

// Parse custom scenario or use defaults
let scenarios: BenchmarkScenario[];

const toolsArg = getArg('tools');
if (toolsArg) {
  scenarios = [{
    name: 'Custom',
    toolCount: parseInt(toolsArg),
    turns: parseInt(getArg('turns') ?? '10'),
    toolsUsedPerTurn: 1,
    uniqueToolsUsed: parseInt(getArg('used') ?? '4'),
    schemaComplexity: (getArg('complexity') ?? 'medium') as SchemaComplexity,
  }];
} else {
  scenarios = DEFAULT_SCENARIOS;
}

// Parse renderers
const formatStr = getArg('format') ?? 'terminal';
const formats = formatStr.split(',');
const outDir = getArg('out') ?? './benchmark-results';

const renderers: ReportRenderer[] = [];
if (formats.includes('terminal')) renderers.push(new TerminalTableRenderer());
if (formats.includes('json')) renderers.push(new JsonReportRenderer(outDir));
if (formats.includes('markdown')) renderers.push(new MarkdownReportRenderer(outDir));

if (renderers.length === 0) renderers.push(new TerminalTableRenderer());

const runner = new BenchmarkRunner({
  scenarios,
  costModels: [
    new McpNativeCostModel(),
    new McpProgressiveCostModel(),
    new Mcp2CliCostModel(),
    new NekteCostModel(),
    new NekteCachedCostModel(),
  ],
  renderers,
  seed: parseInt(getArg('seed') ?? '42'),
  costPerMTok: parseFloat(getArg('cost') ?? '3'),
});

runner.run();
