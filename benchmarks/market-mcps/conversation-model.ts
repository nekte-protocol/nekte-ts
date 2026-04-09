/**
 * Realistic Conversation Model
 *
 * Models what ACTUALLY happens in an LLM context window during a
 * multi-turn agent conversation. This is what the user pays for.
 *
 * Key insight: LLMs don't process turns independently. Every API call
 * includes the FULL conversation history. So turn N costs:
 *
 *   system_prompt + tool_schemas + Σ(user_msg[1..N] + assistant_msg[1..N] + tool_result[1..N])
 *
 * This means prior turns compound. A 12-turn conversation doesn't cost
 * 12× one turn — it costs ~78× one turn (triangular sum).
 *
 * ┌────────────────────────────────────────────────────────────────────┐
 * │ Turn 1:  [system] [schemas] [user₁] [assistant₁] [tool_result₁]  │
 * │ Turn 2:  [system] [schemas] [user₁] [a₁] [t₁] [user₂] [a₂] [t₂]│
 * │ Turn 3:  [system] [schemas] [u₁][a₁][t₁][u₂][a₂][t₂][u₃][a₃][t₃]
 * │ ...                                                               │
 * │ Turn N:  [system] [schemas] [all prior messages] [uₙ] [aₙ] [tₙ]  │
 * └────────────────────────────────────────────────────────────────────┘
 */

import { countTokens } from './tokenizer.js';
import { generateResponse } from './mcp-servers/responses.js';
import { collectTools } from './mcp-servers/registry.js';
import { createAllProtocols, type ProtocolSimulator } from './protocols/index.js';
import type { Scenario, ProtocolId, McpToolDef } from './types.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ConversationModelConfig {
  /** Typical system prompt size in tokens */
  system_prompt_tokens: number;
  /** Average user message size per turn in tokens */
  user_message_tokens: number;
  /** Average assistant reasoning/response size per turn in tokens */
  assistant_message_tokens: number;
  /** Context window limit (tokens). Triggers eviction when exceeded. */
  context_window_limit: number;
  /** When context exceeds limit, drop oldest N turns */
  eviction_turns: number;
  /** After eviction, tools must be re-discovered (for stateful protocols) */
  rediscovery_after_eviction: boolean;
}

const REALISTIC_CONFIG: ConversationModelConfig = {
  system_prompt_tokens: 1500,     // Typical Claude/GPT system prompt with task instructions
  user_message_tokens: 150,       // "Check the CI status for PR #89 and tell me if it's safe to merge"
  assistant_message_tokens: 300,  // Agent reasoning + tool call decision + brief explanation
  context_window_limit: 128_000,  // Claude 3.5 Sonnet / GPT-4o context window
  eviction_turns: 4,              // Drop oldest 4 turns when hitting limit
  rediscovery_after_eviction: true,
};

// ---------------------------------------------------------------------------
// Per-turn conversation state
// ---------------------------------------------------------------------------

export interface ConversationTurnDetail {
  turn: number;
  description: string;
  tool: string;
  /** What the LLM actually sees this turn (input tokens billed) */
  input_tokens: {
    system_prompt: number;
    tool_schemas: number;
    prior_messages: number;
    current_user_msg: number;
    current_tool_result: number;
    total: number;
  };
  /** Cumulative tokens billed up to this turn (sum of all turns' input_tokens) */
  cumulative_billed: number;
  /** Budget level used (may shift under pressure) */
  effective_budget: 'minimal' | 'compact' | 'full';
  /** Was context evicted before this turn? */
  eviction_occurred: boolean;
  /** Was schema re-discovery needed? */
  rediscovery_needed: boolean;
  /** Context window utilization (0-1) */
  context_utilization: number;
}

export interface ConversationResult {
  scenario: string;
  protocol: ProtocolId;
  turns: ConversationTurnDetail[];
  /** Total input tokens billed across entire conversation */
  total_billed_tokens: number;
  /** Number of context evictions that occurred */
  evictions: number;
  /** Number of schema re-discoveries */
  rediscoveries: number;
}

export interface ConversationComparison {
  scenario: string;
  goal: string;
  servers: string[];
  tool_count: number;
  turn_count: number;
  config: ConversationModelConfig;
  results: Record<ProtocolId, ConversationResult>;
  /** Savings vs MCP native (based on total billed tokens) */
  savings: Record<ProtocolId, number>;
}

// ---------------------------------------------------------------------------
// Dynamic budget: tightens as context fills
// ---------------------------------------------------------------------------

function dynamicBudget(
  requestedBudget: 'minimal' | 'compact' | 'full',
  contextUtilization: number,
): 'minimal' | 'compact' | 'full' {
  // Under 60% utilization: use requested budget
  if (contextUtilization < 0.6) return requestedBudget;
  // 60-80%: downgrade full→compact
  if (contextUtilization < 0.8) {
    return requestedBudget === 'full' ? 'compact' : requestedBudget;
  }
  // 80%+: downgrade everything except minimal
  if (requestedBudget === 'full') return 'minimal';
  if (requestedBudget === 'compact') return 'minimal';
  return 'minimal';
}

// ---------------------------------------------------------------------------
// Simulate one full conversation under a protocol
// ---------------------------------------------------------------------------

export function simulateConversation(
  scenario: Scenario,
  protocolSim: ProtocolSimulator,
  allTools: McpToolDef[],
  config: ConversationModelConfig = REALISTIC_CONFIG,
): ConversationResult {
  protocolSim.reset?.();

  const turns: ConversationTurnDetail[] = [];
  let cumulativeBilled = 0;
  let evictions = 0;
  let rediscoveries = 0;

  // Track message history size (grows each turn)
  let priorMessagesTokens = 0;

  // Track which tools have been used (for re-discovery after eviction)
  const usedTools = new Set<string>();

  for (let i = 0; i < scenario.turns.length; i++) {
    const turn = scenario.turns[i];

    // --- Context utilization check ---
    const estimatedContextSize =
      config.system_prompt_tokens +
      getSchemaTokensForProtocol(protocolSim, allTools) +
      priorMessagesTokens +
      config.user_message_tokens +
      config.assistant_message_tokens;

    const utilization = estimatedContextSize / config.context_window_limit;

    // --- Context eviction ---
    let evictionOccurred = false;
    let rediscoveryNeeded = false;

    if (utilization > 0.95 && i > 0) {
      // Evict oldest turns (drop their message tokens)
      const tokensToEvict = estimateEvictionSavings(turns, config.eviction_turns);
      priorMessagesTokens = Math.max(0, priorMessagesTokens - tokensToEvict);
      evictionOccurred = true;
      evictions++;

      // Schema re-discovery if protocol is stateful
      if (config.rediscovery_after_eviction) {
        protocolSim.reset?.();
        rediscoveryNeeded = true;
        rediscoveries++;
        // Re-discover all previously used tools
        for (const t of usedTools) {
          const dummyResponse = { content: [{ type: 'text', text: '{}' }] };
          protocolSim.turnCost(dummyResponse, t, 'minimal');
        }
      }
    }

    // --- Dynamic budget under pressure ---
    const effectiveBudget = dynamicBudget(turn.budget, utilization);

    // --- Generate response and measure ---
    const response = generateResponse(turn.server, turn.tool, turn.args);
    const protocolCost = protocolSim.turnCost(response, turn.tool, effectiveBudget);
    usedTools.add(turn.tool);

    // --- Calculate what the LLM actually sees this turn ---
    const inputTokens = {
      system_prompt: config.system_prompt_tokens,
      tool_schemas: protocolCost.schema_tokens,
      prior_messages: priorMessagesTokens,
      current_user_msg: config.user_message_tokens,
      current_tool_result: protocolCost.response_tokens,
      total: 0,
    };
    inputTokens.total =
      inputTokens.system_prompt +
      inputTokens.tool_schemas +
      inputTokens.prior_messages +
      inputTokens.current_user_msg +
      inputTokens.current_tool_result;

    cumulativeBilled += inputTokens.total;

    // --- Add this turn's messages to history for next turn ---
    // Next turn will see: user_msg + assistant_msg + tool_result from this turn
    priorMessagesTokens +=
      config.user_message_tokens +
      config.assistant_message_tokens +
      protocolCost.response_tokens;

    const newUtilization = inputTokens.total / config.context_window_limit;

    turns.push({
      turn: i + 1,
      description: turn.description,
      tool: turn.tool,
      input_tokens: inputTokens,
      cumulative_billed: cumulativeBilled,
      effective_budget: effectiveBudget,
      eviction_occurred: evictionOccurred,
      rediscovery_needed: rediscoveryNeeded,
      context_utilization: Math.min(1, newUtilization),
    });
  }

  return {
    scenario: scenario.name,
    protocol: protocolSim.id,
    turns,
    total_billed_tokens: cumulativeBilled,
    evictions,
    rediscoveries,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Estimate schema tokens for a protocol (for utilization calculation) */
function getSchemaTokensForProtocol(sim: ProtocolSimulator, tools: McpToolDef[]): number {
  // Rough estimate: schema cost is proportional to what the protocol sends
  if (sim.id === 'mcp_native') return countTokens(tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })));
  if (sim.id === 'mcp_progressive') return countTokens(tools.map((t) => ({ name: t.name, description: t.description.slice(0, 60) })));
  if (sim.id === 'mcp2cli') return countTokens(tools.map((t) => t.name));
  // NEKTE: L0 catalog
  return countTokens(tools.map((t) => ({ id: t.name, category: 'default' })));
}

/** Estimate how many tokens evicting N oldest turns would save */
function estimateEvictionSavings(turns: ConversationTurnDetail[], n: number): number {
  const oldest = turns.slice(0, n);
  return oldest.reduce(
    (sum, t) =>
      sum + t.input_tokens.current_user_msg + t.input_tokens.current_tool_result + 300, // +300 for assistant msg
    0,
  );
}

// ---------------------------------------------------------------------------
// Run all protocols for a scenario
// ---------------------------------------------------------------------------

export function compareProtocols(
  scenario: Scenario,
  config: ConversationModelConfig = REALISTIC_CONFIG,
): ConversationComparison {
  const allTools = collectTools(scenario.servers);
  const protocols = createAllProtocols(allTools);
  const results: Record<string, ConversationResult> = {};

  for (const proto of protocols) {
    results[proto.id] = simulateConversation(scenario, proto, allTools, config);
  }

  const nativeTotal = results['mcp_native'].total_billed_tokens;
  const savings: Record<string, number> = {};
  for (const proto of protocols) {
    savings[proto.id] = nativeTotal > 0
      ? Math.round(((nativeTotal - results[proto.id].total_billed_tokens) / nativeTotal) * 100)
      : 0;
  }

  return {
    scenario: scenario.name,
    goal: scenario.goal,
    servers: scenario.servers,
    tool_count: allTools.length,
    turn_count: scenario.turns.length,
    config,
    results: results as Record<ProtocolId, ConversationResult>,
    savings: savings as Record<ProtocolId, number>,
  };
}

export { REALISTIC_CONFIG };
