#!/usr/bin/env node
/**
 * Market MCP Benchmark — CLI Entry Point
 *
 * Runs rigorous benchmarks against real MCP server schemas from the
 * market (@modelcontextprotocol packages), with tiktoken tokenization
 * and statistical analysis.
 *
 * Usage:
 *   pnpm benchmark:market                          # All scenarios + scaling study
 *   pnpm benchmark:market --verbose                # Per-turn detail
 *   pnpm benchmark:market --scenario "DevOps"      # Filter by name
 *   pnpm benchmark:market --json                   # JSON output for CI
 *   pnpm benchmark:market --markdown               # Markdown report
 *   pnpm benchmark:market --runs 50                # Custom run count
 *   pnpm benchmark:market --scaling-only            # Only scaling study
 *   pnpm benchmark:market --fast                   # Quick mode (5 runs, 1 warmup)
 *   pnpm benchmark:market --no-conversation         # Skip conversation model
 */

import { ALL_SCENARIOS } from './scenarios/index.js';
import { runAllScenarios, type RunnerConfig } from './runner.js';
import { runScalingStudy } from './scaling/schema-weight-study.js';
import { compareProtocols } from './conversation-model.js';
import { compareStrategies, renderStrategyComparison } from './optimizations.js';
import {
  renderTerminal,
  renderConversationModel,
  writeJsonReport,
  writeMarkdownReport,
} from './renderer.js';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`) || args.includes(`-${name.charAt(0)}`);
}

function getFlagValue(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const verbose = hasFlag('verbose');
const jsonOutput = hasFlag('json');
const markdownOutput = hasFlag('markdown');
const scalingOnly = hasFlag('scaling-only');
const noConversation = hasFlag('no-conversation');
const fast = hasFlag('fast');
const scenarioFilter = getFlagValue('scenario');
const customRuns = getFlagValue('runs');

const config: RunnerConfig = {
  runs: customRuns ? parseInt(customRuns, 10) : fast ? 5 : 30,
  warmup: fast ? 1 : 3,
  scenarioFilter,
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startTime = performance.now();

  if (!scalingOnly) {
    const scenarioCount = scenarioFilter
      ? ALL_SCENARIOS.filter((s) => s.name.toLowerCase().includes(scenarioFilter.toLowerCase())).length
      : ALL_SCENARIOS.length;

    console.log(`\nRunning ${scenarioCount} scenario(s) × ${config.runs} runs (+${config.warmup} warmup)...\n`);
  }

  // Run scenarios (unless scaling-only)
  const report = scalingOnly
    ? {
        timestamp: new Date().toISOString(),
        config: { runs_per_scenario: 0, warmup_runs: 0, tokenizer: 'tiktoken/cl100k_base' },
        scenarios: [],
        scaling: [],
        summary: { total_scenarios: 0, total_turns: 0, total_runs: 0, overall_savings: {} as Record<string, number> },
      }
    : runAllScenarios(ALL_SCENARIOS, config);

  // Run scaling study
  console.log('Running schema weight scaling study...\n');
  report.scaling = runScalingStudy();

  // Run conversation model (unless disabled)
  let conversationComparisons: ReturnType<typeof compareProtocols>[] = [];
  if (!scalingOnly && !noConversation) {
    console.log('Running realistic conversation model...\n');
    const scenarios = scenarioFilter
      ? ALL_SCENARIOS.filter((s) => s.name.toLowerCase().includes(scenarioFilter.toLowerCase()))
      : ALL_SCENARIOS;
    conversationComparisons = scenarios.map((s) => compareProtocols(s));
  }

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);

  // Output
  if (jsonOutput) {
    const path = writeJsonReport(report as Parameters<typeof writeJsonReport>[0]);
    console.log(`JSON report written to ${path}`);
  }

  if (!jsonOutput || verbose) {
    renderTerminal(report as Parameters<typeof renderTerminal>[0], verbose);
  }

  // Conversation model output + optimization strategies
  let strategyComparisons: ReturnType<typeof compareStrategies>[] = [];
  if (conversationComparisons.length > 0) {
    renderConversationModel(conversationComparisons);

    console.log('Running optimization strategies...\n');
    const scenarios = scenarioFilter
      ? ALL_SCENARIOS.filter((s) => s.name.toLowerCase().includes(scenarioFilter.toLowerCase()))
      : ALL_SCENARIOS;
    strategyComparisons = scenarios.map((s) => compareStrategies(s));
    renderStrategyComparison(strategyComparisons);
  }

  // Write markdown with all sections (conversation + strategies included)
  if (markdownOutput) {
    writeMarkdownReport(
      report as Parameters<typeof writeMarkdownReport>[0],
      undefined,
      { conversations: conversationComparisons, strategies: strategyComparisons },
    );
    console.log('Markdown report written to benchmarks/results/BENCHMARK_RESULTS.md');
  }

  console.log(`\nCompleted in ${elapsed}s\n`);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
