/**
 * NEKTE Optimization Strategies
 *
 * The cost decomposition reveals:
 *   - Message history = 60-78% of total billed tokens
 *   - Tool results in history = 35-68% of that history
 *   - System prompt = 5-28% (fixed, cannot compress)
 *   - Schemas = 1% under NEKTE (already solved)
 *
 * The biggest lever is compressing HISTORICAL tool results, not just
 * current ones. These strategies target that.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  Strategy 1: History Decay — progressively compress older turns  │
 * │  Strategy 2: Sliding Window — keep last K turns full, summarize │
 * │  Strategy 3: Delta Encoding — dedup repeated tool results       │
 * │  Strategy 4: Combined — all strategies together                 │
 * └──────────────────────────────────────────────────────────────────┘
 */

import { countTokens } from './tokenizer.js';
import { generateResponse } from './mcp-servers/responses.js';
import { collectTools } from './mcp-servers/registry.js';
import { createNekte, type ProtocolSimulator } from './protocols/index.js';
import {
  simulateConversation,
  REALISTIC_CONFIG,
  type ConversationModelConfig,
  type ConversationTurnDetail,
  type ConversationResult,
} from './conversation-model.js';
import type { Scenario, ProtocolId, McpToolDef } from './types.js';

// ---------------------------------------------------------------------------
// Strategy 1: History Decay
// ---------------------------------------------------------------------------
// Older tool results in history are progressively compressed.
//
//   Turn T-1:  full response in history (as-is)
//   Turn T-2:  compact (flattened JSON, 3-item arrays)
//   Turn T-3:  minimal (first line, ~80 chars)
//   Turn T-4+: reference only ("→ see turn 3: query returned 12 rows")
//
// This mirrors how humans read conversation history: recent turns matter
// most, older context just needs to be recognizable.

interface HistoryEntry {
  turn: number;
  tool: string;
  userTokens: number;
  assistantTokens: number;
  /** Result tokens at each compression level */
  resultFull: number;
  resultCompact: number;
  resultMinimal: number;
  resultReference: number; // ~15-25 tokens
}

function decayHistoryTokens(entries: HistoryEntry[], currentTurn: number): number {
  let total = 0;
  for (const entry of entries) {
    const age = currentTurn - entry.turn;
    total += entry.userTokens + entry.assistantTokens;
    if (age <= 1) {
      total += entry.resultFull;      // T-1: keep full
    } else if (age <= 2) {
      total += entry.resultCompact;   // T-2: compact
    } else if (age <= 3) {
      total += entry.resultMinimal;   // T-3: minimal
    } else {
      total += entry.resultReference; // T-4+: reference only
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Strategy 2: Sliding Window Summary
// ---------------------------------------------------------------------------
// Keep the last W turns in full detail. Everything older is collapsed
// into a single "conversation summary" of fixed size (~200 tokens).
//
// This is what advanced agents (Claude, Cursor) actually do when
// approaching context limits.

const SUMMARY_TOKENS = 200; // Fixed summary of all older turns
const WINDOW_SIZE = 4;      // Keep last 4 turns in full

function slidingWindowHistoryTokens(entries: HistoryEntry[], currentTurn: number): number {
  let total = 0;
  const windowStart = currentTurn - WINDOW_SIZE;

  // Entries older than window → collapsed into fixed summary
  const hasOlderEntries = entries.some((e) => e.turn < windowStart);
  if (hasOlderEntries) {
    total += SUMMARY_TOKENS;
  }

  // Entries within window → full
  for (const entry of entries) {
    if (entry.turn >= windowStart) {
      total += entry.userTokens + entry.assistantTokens + entry.resultFull;
    }
  }

  return total;
}

// ---------------------------------------------------------------------------
// Strategy 3: Delta Encoding
// ---------------------------------------------------------------------------
// If the same tool is called again, only send the diff vs previous result.
// Common in real workflows: "query" called 5 times, "get_issue" called
// for different issues (same structure, different values).
//
// Estimated savings:
//   - Same tool, same args: ~90% reduction (only "no change" marker)
//   - Same tool, different args: ~40% reduction (same structure, diff values)
//   - Different tool: 0% reduction

function deltaEncodingFactor(tool: string, previousTools: Map<string, number>): number {
  if (!previousTools.has(tool)) {
    return 1.0; // First call: no savings
  }
  // Same tool called again: ~40% of original size (structural dedup)
  return 0.4;
}

// ---------------------------------------------------------------------------
// Custom Conversation Simulator (with optimizations)
// ---------------------------------------------------------------------------

export type OptimizationStrategy = 'history_decay' | 'sliding_window' | 'delta_encoding' | 'combined';

export interface OptimizedResult extends ConversationResult {
  strategy: OptimizationStrategy;
}

export function simulateOptimized(
  scenario: Scenario,
  strategy: OptimizationStrategy,
  config: ConversationModelConfig = REALISTIC_CONFIG,
): OptimizedResult {
  const allTools = collectTools(scenario.servers);
  const nekte = createNekte(allTools);
  nekte.reset?.();

  const turns: ConversationTurnDetail[] = [];
  let cumulativeBilled = 0;

  const history: HistoryEntry[] = [];
  const previousToolCalls = new Map<string, number>(); // tool → last result tokens

  for (let i = 0; i < scenario.turns.length; i++) {
    const turn = scenario.turns[i];

    // Generate response and get NEKTE cost for this turn
    const response = generateResponse(turn.server, turn.tool, turn.args);
    const protocolCost = nekte.turnCost(response, turn.tool, turn.budget);

    // --- Apply delta encoding to current result (Strategy 3) ---
    let effectiveResultTokens = protocolCost.response_tokens;
    if (strategy === 'delta_encoding' || strategy === 'combined') {
      const factor = deltaEncodingFactor(turn.tool, previousToolCalls);
      effectiveResultTokens = Math.round(protocolCost.response_tokens * factor);
    }
    previousToolCalls.set(turn.tool, protocolCost.response_tokens);

    // --- Build a HistoryEntry for compact/minimal estimates ---
    // These are pre-computed so decay/window can pick the right level
    const fullResultTokens = effectiveResultTokens;
    const compactResultTokens = Math.round(fullResultTokens * 0.35); // compact ≈ 35% of full
    const minimalResultTokens = Math.min(25, fullResultTokens);       // minimal ≈ 20-25 tokens
    const referenceTokens = 15; // "→ turn N: tool_name returned K items"

    // --- Calculate history tokens using the chosen strategy ---
    let historyTokens: number;
    if (strategy === 'history_decay' || strategy === 'combined') {
      historyTokens = decayHistoryTokens(history, i + 1);
    } else if (strategy === 'sliding_window') {
      historyTokens = slidingWindowHistoryTokens(history, i + 1);
    } else {
      // delta_encoding only: history is same as base NEKTE
      historyTokens = history.reduce(
        (sum, e) => sum + e.userTokens + e.assistantTokens + e.resultFull,
        0,
      );
    }

    // --- Assemble input tokens ---
    const inputTokens = {
      system_prompt: config.system_prompt_tokens,
      tool_schemas: protocolCost.schema_tokens,
      prior_messages: historyTokens,
      current_user_msg: config.user_message_tokens,
      current_tool_result: effectiveResultTokens,
      total: 0,
    };
    inputTokens.total =
      inputTokens.system_prompt +
      inputTokens.tool_schemas +
      inputTokens.prior_messages +
      inputTokens.current_user_msg +
      inputTokens.current_tool_result;

    cumulativeBilled += inputTokens.total;

    // --- Add to history for next turn ---
    history.push({
      turn: i + 1,
      tool: turn.tool,
      userTokens: config.user_message_tokens,
      assistantTokens: config.assistant_message_tokens,
      resultFull: fullResultTokens,
      resultCompact: compactResultTokens,
      resultMinimal: minimalResultTokens,
      resultReference: referenceTokens,
    });

    const contextUsed = inputTokens.total / config.context_window_limit;

    turns.push({
      turn: i + 1,
      description: turn.description,
      tool: turn.tool,
      input_tokens: inputTokens,
      cumulative_billed: cumulativeBilled,
      effective_budget: turn.budget,
      eviction_occurred: false,
      rediscovery_needed: false,
      context_utilization: Math.min(1, contextUsed),
    });
  }

  return {
    scenario: scenario.name,
    protocol: 'nekte' as ProtocolId,
    turns,
    total_billed_tokens: cumulativeBilled,
    evictions: 0,
    rediscoveries: 0,
    strategy,
  };
}

// ---------------------------------------------------------------------------
// Run all strategies for comparison
// ---------------------------------------------------------------------------

export interface StrategyComparison {
  scenario: string;
  turn_count: number;
  tool_count: number;
  /** Baseline: MCP Native with conversation model */
  mcp_native_total: number;
  /** Baseline: NEKTE without optimizations */
  nekte_base_total: number;
  nekte_base_savings: number;
  /** Each strategy's results */
  strategies: Record<OptimizationStrategy, {
    total: number;
    savings_vs_native: number;
    savings_vs_nekte_base: number;
    improvement_pp: number; // percentage points gained over base NEKTE
  }>;
}

export function compareStrategies(scenario: Scenario): StrategyComparison {
  const allTools = collectTools(scenario.servers);

  // Get baselines from conversation model
  const { compareProtocols } = require('./conversation-model.js') as typeof import('./conversation-model.js');
  const baseComparison = compareProtocols(scenario);
  const nativeTotal = baseComparison.results['mcp_native'].total_billed_tokens;
  const nekteBaseTotal = baseComparison.results['nekte'].total_billed_tokens;
  const nekteBaseSavings = Math.round(((nativeTotal - nekteBaseTotal) / nativeTotal) * 100);

  const strategyNames: OptimizationStrategy[] = ['history_decay', 'sliding_window', 'delta_encoding', 'combined'];
  const strategies: StrategyComparison['strategies'] = {} as StrategyComparison['strategies'];

  for (const strat of strategyNames) {
    const result = simulateOptimized(scenario, strat);
    const savingsVsNative = Math.round(((nativeTotal - result.total_billed_tokens) / nativeTotal) * 100);
    const savingsVsBase = Math.round(((nekteBaseTotal - result.total_billed_tokens) / nekteBaseTotal) * 100);
    const improvementPp = savingsVsNative - nekteBaseSavings;

    strategies[strat] = {
      total: result.total_billed_tokens,
      savings_vs_native: savingsVsNative,
      savings_vs_nekte_base: savingsVsBase,
      improvement_pp: improvementPp,
    };
  }

  return {
    scenario: scenario.name,
    turn_count: scenario.turns.length,
    tool_count: allTools.length,
    mcp_native_total: nativeTotal,
    nekte_base_total: nekteBaseTotal,
    nekte_base_savings: nekteBaseSavings,
    strategies,
  };
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const STRATEGY_LABELS: Record<OptimizationStrategy, string> = {
  history_decay: 'History Decay',
  sliding_window: 'Sliding Window',
  delta_encoding: 'Delta Encoding',
  combined: 'Combined (all)',
};

export function renderStrategyComparison(comparisons: StrategyComparison[]): void {
  const out = console.log;
  const B = '\x1b[1m', R = '\x1b[0m', G = '\x1b[32m', Y = '\x1b[33m', C = '\x1b[36m', D = '\x1b[2m';

  out(`\n${B}${C}╔══════════════════════════════════════════════════════════════════════╗${R}`);
  out(`${B}${C}║  OPTIMIZATION STRATEGIES: Improving NEKTE's Real Conversation Score  ║${R}`);
  out(`${B}${C}╚══════════════════════════════════════════════════════════════════════╝${R}\n`);

  out(`${D}  Strategy 1 — History Decay: older turns progressively compressed (full→compact→minimal→ref)${R}`);
  out(`${D}  Strategy 2 — Sliding Window: last 4 turns full, older collapsed to 200-token summary${R}`);
  out(`${D}  Strategy 3 — Delta Encoding: repeated tool calls send ~40% (structural dedup)${R}`);
  out(`${D}  Strategy 4 — Combined: all three strategies applied together${R}\n`);

  for (const comp of comparisons) {
    out(`${B}━━━ ${comp.scenario} (${comp.turn_count} turns, ${comp.tool_count} tools) ━━━${R}\n`);

    const pad = (s: string, n: number, a: 'left' | 'right' = 'right') => {
      const stripped = s.replace(/\x1b\[[0-9;]*m/g, '');
      const d = n - stripped.length;
      return d <= 0 ? s : a === 'right' ? ' '.repeat(d) + s : s + ' '.repeat(d);
    };
    const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n);

    out(`  ${pad('Protocol/Strategy', 22, 'left')} ${pad('Total', 9)} ${pad('vs Native', 10)} ${pad('vs NEKTE', 10)} ${pad('Δ pp', 6)}`);
    out(`  ${'─'.repeat(60)}`);

    // MCP Native baseline
    out(`  ${pad('MCP Native', 22, 'left')} ${pad(fmt(comp.mcp_native_total), 9)} ${pad('—', 10)} ${pad('—', 10)} ${pad('—', 6)}`);

    // NEKTE base
    out(`  ${pad('NEKTE (base)', 22, 'left')} ${pad(fmt(comp.nekte_base_total), 9)} ${pad(comp.nekte_base_savings + '%', 10)} ${pad('—', 10)} ${pad('—', 6)}`);

    // Each strategy
    for (const strat of ['history_decay', 'sliding_window', 'delta_encoding', 'combined'] as const) {
      const s = comp.strategies[strat];
      const color = s.improvement_pp >= 15 ? G : s.improvement_pp >= 5 ? Y : D;
      out(
        `  ${pad(STRATEGY_LABELS[strat], 22, 'left')} ` +
        `${pad(fmt(s.total), 9)} ` +
        `${color}${pad(s.savings_vs_native + '%', 10)}${R} ` +
        `${pad(s.savings_vs_nekte_base + '%', 10)} ` +
        `${color}${pad('+' + s.improvement_pp + 'pp', 6)}${R}`,
      );
    }
    out('');
  }

  // Cross-scenario summary
  out(`${B}━━━ SUMMARY: Best Strategy per Scenario ━━━${R}\n`);
  out(`  ${('Scenario').padEnd(22)} ${'Base'.padStart(6)} ${'Best'.padStart(6)} ${'Gain'.padStart(6)}  Strategy`);
  out(`  ${'─'.repeat(60)}`);

  for (const comp of comparisons) {
    let bestStrat: OptimizationStrategy = 'combined';
    let bestSavings = 0;
    for (const [strat, data] of Object.entries(comp.strategies) as [OptimizationStrategy, typeof comp.strategies[OptimizationStrategy]][]) {
      if (data.savings_vs_native > bestSavings) {
        bestSavings = data.savings_vs_native;
        bestStrat = strat;
      }
    }
    const gain = bestSavings - comp.nekte_base_savings;
    out(`  ${comp.scenario.padEnd(22)} ${(comp.nekte_base_savings + '%').padStart(6)} ${G}${(bestSavings + '%').padStart(6)}${R} ${Y}${('+' + gain + 'pp').padStart(6)}${R}  ${STRATEGY_LABELS[bestStrat]}`);
  }
  out('');
}
