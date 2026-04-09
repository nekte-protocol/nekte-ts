/**
 * Statistical Benchmark Runner
 *
 * Runs each scenario N times (after W warm-up runs), collects per-protocol
 * total tokens, and computes descriptive statistics.
 *
 * Design decisions:
 *  - Warm-up runs let tiktoken/JIT settle (discarded from stats)
 *  - Each run resets protocol state (discovery caches, etc.)
 *  - Response generation is deterministic per seed for reproducibility
 *  - All token counts use tiktoken (cl100k_base), not estimates
 */

import { generateResponse } from './mcp-servers/responses.js';
import { collectTools } from './mcp-servers/registry.js';
import { createAllProtocols, type ProtocolSimulator } from './protocols/index.js';
import { countTokens } from './tokenizer.js';
import { computeStats } from './stats.js';
import type {
  Scenario, ProtocolId, TurnResult, ScenarioResult, BenchmarkReport,
} from './types.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface RunnerConfig {
  /** Number of measured runs per scenario (default: 30) */
  runs: number;
  /** Number of warm-up runs to discard (default: 3) */
  warmup: number;
  /** Filter scenarios by name (case-insensitive substring) */
  scenarioFilter?: string;
}

const DEFAULT_CONFIG: RunnerConfig = { runs: 30, warmup: 3 };

// ---------------------------------------------------------------------------
// Single run
// ---------------------------------------------------------------------------

function runSingleScenario(
  scenario: Scenario,
  protocols: ProtocolSimulator[],
): { turns: TurnResult[]; totals: Record<ProtocolId, number> } {
  // Reset all protocol state
  for (const p of protocols) p.reset?.();

  const turns: TurnResult[] = [];
  const totals: Record<string, number> = {};
  for (const p of protocols) totals[p.id] = 0;

  for (let i = 0; i < scenario.turns.length; i++) {
    const turn = scenario.turns[i];
    const response = generateResponse(turn.server, turn.tool, turn.args);
    const rawTokens = countTokens(response);

    const costs: Record<string, { schema_tokens: number; response_tokens: number; total_tokens: number }> = {};
    for (const p of protocols) {
      const cost = p.turnCost(response, turn.tool, turn.budget);
      costs[p.id] = cost;
      totals[p.id] += cost.total_tokens;
    }

    const nekteCost = costs['nekte'];
    turns.push({
      turn: i + 1,
      description: turn.description,
      tool: turn.tool,
      server: turn.server,
      raw_response_tokens: rawTokens,
      costs: costs as Record<ProtocolId, TurnResult['costs'][ProtocolId]>,
      compression_ratio: rawTokens > 0 ? nekteCost.response_tokens / rawTokens : 1,
    });
  }

  return { turns, totals: totals as Record<ProtocolId, number> };
}

// ---------------------------------------------------------------------------
// Scenario runner with statistics
// ---------------------------------------------------------------------------

export function runScenario(scenario: Scenario, config: RunnerConfig = DEFAULT_CONFIG): ScenarioResult {
  const allTools = collectTools(scenario.servers);
  const protocols = createAllProtocols(allTools);
  const protocolIds = protocols.map((p) => p.id);

  // Schema weight measurement (real tiktoken count)
  const toolsListPayload = allTools.map((t) => ({
    name: t.name, description: t.description, inputSchema: t.inputSchema,
  }));
  const toolsListJson = JSON.stringify(toolsListPayload);
  const toolsListTokens = countTokens(toolsListPayload);

  // Warm-up runs (discard)
  for (let w = 0; w < config.warmup; w++) {
    runSingleScenario(scenario, protocols);
  }

  // Measured runs
  const perProtocolTotals: Record<string, number[]> = {};
  for (const id of protocolIds) perProtocolTotals[id] = [];

  let representativeTurns: TurnResult[] = [];

  for (let r = 0; r < config.runs; r++) {
    const { turns, totals } = runSingleScenario(scenario, protocols);
    for (const id of protocolIds) {
      perProtocolTotals[id].push(totals[id]);
    }
    // Keep first measured run as representative
    if (r === 0) representativeTurns = turns;
  }

  // Compute statistics
  const protocolStats: Record<string, ReturnType<typeof computeStats>> = {};
  for (const id of protocolIds) {
    protocolStats[id] = computeStats(perProtocolTotals[id]);
  }

  // Savings vs native
  const nativeMean = protocolStats['mcp_native'].mean;
  const savings: Record<string, number> = {};
  for (const id of protocolIds) {
    savings[id] = nativeMean > 0
      ? Math.round(((nativeMean - protocolStats[id].mean) / nativeMean) * 100)
      : 0;
  }

  return {
    scenario: scenario.name,
    goal: scenario.goal,
    servers: scenario.servers,
    turn_count: scenario.turns.length,
    protocol_stats: protocolStats as ScenarioResult['protocol_stats'],
    savings_vs_native: savings as ScenarioResult['savings_vs_native'],
    representative_turns: representativeTurns,
    schema_weight: {
      tools_list_bytes: toolsListJson.length,
      tools_list_tokens: toolsListTokens,
      tool_count: allTools.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Full benchmark
// ---------------------------------------------------------------------------

export function runAllScenarios(
  scenarios: Scenario[],
  config: RunnerConfig = DEFAULT_CONFIG,
): BenchmarkReport {
  const results: ScenarioResult[] = [];

  for (const scenario of scenarios) {
    const filtered = config.scenarioFilter
      ? scenario.name.toLowerCase().includes(config.scenarioFilter.toLowerCase())
      : true;
    if (!filtered) continue;
    results.push(runScenario(scenario, config));
  }

  // Overall savings (weighted by turn count)
  const protocolIds: ProtocolId[] = ['mcp_native', 'mcp_progressive', 'mcp2cli', 'nekte', 'nekte_cached'];
  const overallTotals: Record<string, number> = {};
  for (const id of protocolIds) {
    overallTotals[id] = results.reduce((s, r) => s + r.protocol_stats[id].mean * r.turn_count, 0);
  }
  const overallNative = overallTotals['mcp_native'];
  const overallSavings: Record<string, number> = {};
  for (const id of protocolIds) {
    overallSavings[id] = overallNative > 0
      ? Math.round(((overallNative - overallTotals[id]) / overallNative) * 100)
      : 0;
  }

  return {
    timestamp: new Date().toISOString(),
    config: {
      runs_per_scenario: config.runs,
      warmup_runs: config.warmup,
      tokenizer: 'tiktoken/cl100k_base',
    },
    scenarios: results,
    scaling: [], // Filled by scaling study
    summary: {
      total_scenarios: results.length,
      total_turns: results.reduce((s, r) => s + r.turn_count, 0),
      total_runs: results.length * (config.runs + config.warmup),
      overall_savings: overallSavings as Record<ProtocolId, number>,
    },
  };
}
