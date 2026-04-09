/**
 * Schema Weight Scaling Study (Proposal B)
 *
 * Measures how context window cost scales as you add more MCP servers.
 * This is the core argument for NEKTE: MCP native scales O(tools × turns)
 * while NEKTE scales O(tools + used_tools).
 *
 * Methodology:
 *  - Incrementally add servers: 1 → 2 → 3 → 4 → 5
 *  - At each level, run a fixed 10-turn workflow using tools from ALL servers
 *  - Measure per-protocol total tokens with tiktoken
 *  - Generate data points for scaling curve visualization
 *
 * Server addition order (by tool count, ascending):
 *  1. postgres (1 tool)           → cumulative: 1
 *  2. brave-search (2 tools)      → cumulative: 3
 *  3. fetch (1 tool)              → cumulative: 4
 *  4. filesystem (14 tools)       → cumulative: 18
 *  5. github (26 tools)           → cumulative: 44
 */

import { collectTools, getAllServers } from '../mcp-servers/registry.js';
import { generateResponse } from '../mcp-servers/responses.js';
import { createAllProtocols } from '../protocols/index.js';
import { countTokens } from '../tokenizer.js';
import type { ScalingDataPoint, ProtocolId, ConversationTurn } from '../types.js';

// Fixed 10-turn workflow that uses one tool from each server.
// Tools are picked to represent realistic agent behavior.
function getFixedWorkflow(availableServers: string[]): ConversationTurn[] {
  const serverTurns: Record<string, ConversationTurn[]> = {
    postgres: [
      { description: 'Query task stats', tool: 'query', server: 'postgres', args: { sql: "SELECT status, count(*) FROM tasks GROUP BY status" }, budget: 'compact' },
      { description: 'Run EXPLAIN', tool: 'query', server: 'postgres', args: { sql: 'EXPLAIN SELECT * FROM tasks WHERE priority = \'P0\'' }, budget: 'full' },
    ],
    'brave-search': [
      { description: 'Web search', tool: 'brave_web_search', server: 'brave-search', args: { query: 'MCP protocol benchmark', count: 10 }, budget: 'compact' },
      { description: 'Local search', tool: 'brave_local_search', server: 'brave-search', args: { query: 'tech conference SF', count: 5 }, budget: 'minimal' },
    ],
    fetch: [
      { description: 'Fetch docs', tool: 'fetch', server: 'fetch', args: { url: 'https://example.com/docs', max_length: 5000 }, budget: 'compact' },
      { description: 'Fetch API ref', tool: 'fetch', server: 'fetch', args: { url: 'https://example.com/api', max_length: 8000 }, budget: 'full' },
    ],
    filesystem: [
      { description: 'Read file', tool: 'read_text_file', server: 'filesystem', args: { path: '/project/src/index.ts' }, budget: 'full' },
      { description: 'Directory tree', tool: 'directory_tree', server: 'filesystem', args: { path: '/project' }, budget: 'compact' },
    ],
    github: [
      { description: 'Get issue', tool: 'get_issue', server: 'github', args: { owner: 'org', repo: 'repo', issue_number: 1 }, budget: 'full' },
      { description: 'List PRs', tool: 'list_pull_requests', server: 'github', args: { owner: 'org', repo: 'repo', state: 'open' }, budget: 'compact' },
    ],
  };

  // Build a 10-turn workflow: 2 turns per available server, pad with repeats
  const turns: ConversationTurn[] = [];
  for (const srv of availableServers) {
    if (serverTurns[srv]) {
      turns.push(...serverTurns[srv]);
    }
  }
  // Pad to exactly 10 turns by cycling
  while (turns.length < 10) {
    turns.push(turns[turns.length % availableServers.length]);
  }
  return turns.slice(0, 10);
}

// Server addition order: sorted by tool count ascending
const SERVER_ORDER = ['postgres', 'brave-search', 'fetch', 'filesystem', 'github'];

export function runScalingStudy(): ScalingDataPoint[] {
  const dataPoints: ScalingDataPoint[] = [];

  for (let i = 1; i <= SERVER_ORDER.length; i++) {
    const servers = SERVER_ORDER.slice(0, i);
    const allTools = collectTools(servers);
    const protocols = createAllProtocols(allTools);
    const workflow = getFixedWorkflow(servers);

    // Reset protocols
    for (const p of protocols) p.reset?.();

    const protocolTotals: Record<string, number> = {};
    const schemaOnly: Record<string, number> = {};
    for (const p of protocols) {
      protocolTotals[p.id] = 0;
      schemaOnly[p.id] = 0;
    }

    // Run the fixed workflow
    for (const turn of workflow) {
      const response = generateResponse(turn.server, turn.tool, turn.args);
      for (const p of protocols) {
        const cost = p.turnCost(response, turn.tool, turn.budget);
        protocolTotals[p.id] += cost.total_tokens;
        schemaOnly[p.id] += cost.schema_tokens;
      }
    }

    dataPoints.push({
      server_count: servers.length,
      tool_count: allTools.length,
      servers,
      protocol_totals: protocolTotals as Record<ProtocolId, number>,
      schema_only: schemaOnly as Record<ProtocolId, number>,
    });
  }

  return dataPoints;
}
