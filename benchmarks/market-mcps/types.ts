/**
 * Market MCP Benchmark — Shared Types
 */

// ---------------------------------------------------------------------------
// MCP Registry
// ---------------------------------------------------------------------------

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServerDef {
  /** Display name */
  id: string;
  /** npm package name */
  npmPackage: string;
  /** Category for grouping */
  category: 'dev' | 'data' | 'search' | 'infra';
  /** Tool count (for reference) */
  toolCount: number;
  /** Full tool definitions (real schemas from market packages) */
  tools: McpToolDef[];
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export interface ConversationTurn {
  description: string;
  tool: string;
  server: string;
  args: Record<string, unknown>;
  budget: 'minimal' | 'compact' | 'full';
}

export interface Scenario {
  name: string;
  servers: string[];
  goal: string;
  turns: ConversationTurn[];
}

// ---------------------------------------------------------------------------
// Protocol Measurement
// ---------------------------------------------------------------------------

export type ProtocolId =
  | 'mcp_native'
  | 'mcp_progressive'
  | 'mcp2cli'
  | 'nekte'
  | 'nekte_cached';

export interface ProtocolTurnCost {
  schema_tokens: number;
  response_tokens: number;
  total_tokens: number;
}

export interface TurnResult {
  turn: number;
  description: string;
  tool: string;
  server: string;
  raw_response_tokens: number;
  costs: Record<ProtocolId, ProtocolTurnCost>;
  compression_ratio: number;
}

// ---------------------------------------------------------------------------
// Statistical Results
// ---------------------------------------------------------------------------

export interface Stats {
  mean: number;
  median: number;
  p5: number;
  p95: number;
  stddev: number;
  min: number;
  max: number;
  n: number;
}

export interface ScenarioResult {
  scenario: string;
  goal: string;
  servers: string[];
  turn_count: number;
  /** Per-protocol aggregate token stats across N runs */
  protocol_stats: Record<ProtocolId, Stats>;
  /** Savings vs MCP native (mean %) */
  savings_vs_native: Record<ProtocolId, number>;
  /** Per-turn detail (from a single representative run) */
  representative_turns: TurnResult[];
  /** Schema weight metadata */
  schema_weight: {
    tools_list_bytes: number;
    tools_list_tokens: number;
    tool_count: number;
  };
}

// ---------------------------------------------------------------------------
// Scaling Study
// ---------------------------------------------------------------------------

export interface ScalingDataPoint {
  /** Number of MCP servers connected */
  server_count: number;
  /** Total tools available */
  tool_count: number;
  /** Server names included */
  servers: string[];
  /** Per-protocol cost for a fixed 10-turn workflow */
  protocol_totals: Record<ProtocolId, number>;
  /** Schema-only cost (no responses) */
  schema_only: Record<ProtocolId, number>;
}

// ---------------------------------------------------------------------------
// Full Report
// ---------------------------------------------------------------------------

export interface BenchmarkReport {
  timestamp: string;
  config: {
    runs_per_scenario: number;
    warmup_runs: number;
    tokenizer: string;
  };
  scenarios: ScenarioResult[];
  scaling: ScalingDataPoint[];
  summary: {
    total_scenarios: number;
    total_turns: number;
    total_runs: number;
    overall_savings: Record<ProtocolId, number>;
  };
}
