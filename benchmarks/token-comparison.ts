/**
 * Token Comparison Benchmark
 *
 * Simulates the token cost of interacting with N tools over T turns
 * using three approaches: MCP native, mcp2cli, and NEKTE.
 *
 * Run: pnpm benchmark (or: npx tsx benchmarks/token-comparison.ts)
 */

// ---------------------------------------------------------------------------
// Token cost models
// ---------------------------------------------------------------------------

/**
 * MCP Native: full schemas injected on every turn.
 * ~121 tokens per tool per turn (based on Scalekit/Apideck measurements).
 */
function mcpNativeCost(tools: number, turns: number): number {
  const tokensPerToolPerTurn = 121;
  return tools * tokensPerToolPerTurn * turns;
}

/**
 * mcp2cli: lazy discovery via CLI.
 * - --list: ~16 tokens per tool (once)
 * - --help: ~120 tokens per tool (once per unique tool used)
 * - System prompt overhead: ~67 tokens per turn
 */
function mcp2cliCost(
  tools: number,
  turns: number,
  toolsUsed: number,
): number {
  const listCost = tools * 16; // once
  const helpCost = toolsUsed * 120; // once per unique tool
  const systemPrompt = 67 * turns;
  return listCost + helpCost + systemPrompt;
}

/**
 * NEKTE: progressive discovery + zero-schema invocation.
 * - L0 catalog: ~8 tokens per capability (once)
 * - L1 describe: ~40 tokens per capability (once per used tool)
 * - Invoke with hash: ~0 extra tokens (after first call)
 * - Budget envelope: ~15 tokens per request
 * - Response (compact): ~30 tokens avg
 */
function nekteCost(
  tools: number,
  turns: number,
  toolsUsed: number,
): number {
  const catalogCost = tools * 8; // once
  const describeCost = toolsUsed * 40; // once per unique tool
  const invokeOverhead = 15 * turns; // budget field per request
  const responseCost = 30 * turns; // compact responses
  return catalogCost + describeCost + invokeOverhead + responseCost;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

interface Scenario {
  name: string;
  tools: number;
  turns: number;
  toolsUsed: number;
}

const scenarios: Scenario[] = [
  { name: 'Simple chat (5 tools, 5 turns, 2 used)', tools: 5, turns: 5, toolsUsed: 2 },
  { name: 'Dev workflow (15 tools, 10 turns, 4 used)', tools: 15, turns: 10, toolsUsed: 4 },
  { name: 'Medium agent (30 tools, 15 turns, 6 used)', tools: 30, turns: 15, toolsUsed: 6 },
  { name: 'Enterprise (50 tools, 20 turns, 8 used)', tools: 50, turns: 20, toolsUsed: 8 },
  { name: 'Platform (100 tools, 25 turns, 10 used)', tools: 100, turns: 25, toolsUsed: 10 },
  { name: 'Mega (200 tools, 30 turns, 12 used)', tools: 200, turns: 30, toolsUsed: 12 },
];

// ---------------------------------------------------------------------------
// Run benchmark
// ---------------------------------------------------------------------------

function main(): void {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║           NEKTE Token Cost Benchmark v0.2                       ║');
  console.log('║   MCP native vs mcp2cli vs NEKTE                               ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  const rows: string[][] = [];

  rows.push([
    'Scenario',
    'MCP native',
    'mcp2cli',
    'NEKTE',
    'vs MCP',
    'vs mcp2cli',
  ]);

  rows.push(['─'.repeat(36), '─'.repeat(10), '─'.repeat(10), '─'.repeat(10), '─'.repeat(8), '─'.repeat(10)]);

  for (const s of scenarios) {
    const mcp = mcpNativeCost(s.tools, s.turns);
    const cli = mcp2cliCost(s.tools, s.turns, s.toolsUsed);
    const nekte = nekteCost(s.tools, s.turns, s.toolsUsed);

    const vsMcp = `-${Math.round((1 - nekte / mcp) * 100)}%`;
    const vsCli = nekte < cli ? `-${Math.round((1 - nekte / cli) * 100)}%` : `+${Math.round((nekte / cli - 1) * 100)}%`;

    rows.push([
      s.name,
      mcp.toLocaleString(),
      cli.toLocaleString(),
      nekte.toLocaleString(),
      vsMcp,
      vsCli,
    ]);
  }

  // Print table
  const colWidths = rows[0].map((_, i) =>
    Math.max(...rows.map((r) => r[i].length)),
  );

  for (const row of rows) {
    const line = row.map((cell, i) => cell.padEnd(colWidths[i])).join('  │  ');
    console.log(`  ${line}`);
  }

  // Cost analysis
  console.log('\n── Cost analysis (Claude Sonnet 4.6 @ $3/MTok input) ──────────\n');

  const enterpriseScenario = scenarios[3]; // 50 tools, 20 turns
  const conversations = 1000;
  const mcp = mcpNativeCost(enterpriseScenario.tools, enterpriseScenario.turns) * conversations;
  const nekte = nekteCost(enterpriseScenario.tools, enterpriseScenario.turns, enterpriseScenario.toolsUsed) * conversations;
  const rate = 3; // $/MTok

  console.log(`  Scenario: ${enterpriseScenario.name}`);
  console.log(`  Volume: ${conversations.toLocaleString()} conversations/day\n`);
  console.log(`  MCP native:  ${(mcp / 1_000_000).toFixed(2)}M tokens/day  →  $${((mcp / 1_000_000) * rate).toFixed(2)}/day  →  $${((mcp / 1_000_000) * rate * 30).toFixed(0)}/month`);
  console.log(`  NEKTE:       ${(nekte / 1_000_000).toFixed(2)}M tokens/day  →  $${((nekte / 1_000_000) * rate).toFixed(2)}/day  →  $${((nekte / 1_000_000) * rate * 30).toFixed(0)}/month`);
  console.log(`  Savings:     $${(((mcp - nekte) / 1_000_000) * rate * 30).toFixed(0)}/month (${Math.round((1 - nekte / mcp) * 100)}% reduction)\n`);
}

main();
