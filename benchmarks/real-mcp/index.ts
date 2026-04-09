#!/usr/bin/env node
/**
 * Real-World MCP Benchmark — Entry Point
 *
 * Unlike the synthetic benchmarks, this runs actual MCP servers (stdio),
 * replays real agent conversation patterns, and measures actual token
 * costs, latency, and compression ratios.
 *
 * Usage:
 *   pnpm benchmark:real                    # all scenarios, summary view
 *   pnpm benchmark:real --verbose          # per-turn detail
 *   pnpm benchmark:real --scenario "Code Review"
 *   pnpm benchmark:real --json             # JSON output for CI
 *   pnpm benchmark:real --retention        # information loss analysis
 */

import { ALL_SCENARIOS } from './scenarios/index.js';
import { runAllScenarios } from './runner.js';
import { renderReport, renderRetentionReport, reportToJson } from './renderer.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('-v');
const jsonOutput = args.includes('--json');
const retention = args.includes('--retention') || args.includes('-r');

const scenarioIdx = args.indexOf('--scenario');
const scenarioFilter = scenarioIdx >= 0 ? args[scenarioIdx + 1] : undefined;

const scenarios = scenarioFilter
  ? ALL_SCENARIOS.filter((s) => s.name.toLowerCase().includes(scenarioFilter.toLowerCase()))
  : ALL_SCENARIOS;

if (scenarios.length === 0) {
  console.error(`No scenarios match "${scenarioFilter}". Available: ${ALL_SCENARIOS.map((s) => s.name).join(', ')}`);
  process.exit(1);
}

async function main() {
  console.log(`Running ${scenarios.length} real-world scenario(s)...\n`);

  const report = await runAllScenarios(scenarios);

  if (jsonOutput) {
    const outDir = './benchmark-results';
    mkdirSync(outDir, { recursive: true });
    const path = `${outDir}/real-mcp-${Date.now()}.json`;
    writeFileSync(path, reportToJson(report));
    console.log(`JSON report written to ${path}`);
  } else {
    renderReport(report, verbose);
    if (retention) {
      renderRetentionReport(report);
    }
  }
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
