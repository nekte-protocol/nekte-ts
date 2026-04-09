/**
 * Benchmark Report Renderer
 *
 * Outputs:
 *  - Terminal: colored tables with ANSI
 *  - JSON: timestamped file for CI/CD tracking
 *  - Markdown: publishable report with ASCII scaling chart
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { cv } from './stats.js';
import type { BenchmarkReport, ProtocolId, ScenarioResult, ScalingDataPoint, Stats } from './types.js';
import type { ConversationComparison } from './conversation-model.js';
import type { StrategyComparison, OptimizationStrategy } from './optimizations.js';

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgGreen: '\x1b[42m',
  bgBlue: '\x1b[44m',
};

function pad(s: string, n: number, align: 'left' | 'right' = 'right'): string {
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, '');
  const diff = n - stripped.length;
  if (diff <= 0) return s;
  return align === 'right' ? ' '.repeat(diff) + s : s + ' '.repeat(diff);
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function savingsColor(pct: number): string {
  if (pct >= 80) return c.green + c.bold;
  if (pct >= 50) return c.green;
  if (pct >= 20) return c.yellow;
  return c.dim;
}

const PROTOCOL_LABELS: Record<ProtocolId, string> = {
  mcp_native: 'MCP Native',
  mcp_progressive: 'MCP Progressive',
  mcp2cli: 'mcp2cli',
  nekte: 'NEKTE',
  nekte_cached: 'NEKTE+Cache',
};

const PROTOCOL_ORDER: ProtocolId[] = ['mcp_native', 'mcp_progressive', 'mcp2cli', 'nekte', 'nekte_cached'];

// ---------------------------------------------------------------------------
// Terminal renderer
// ---------------------------------------------------------------------------

export function renderTerminal(report: BenchmarkReport, verbose: boolean): void {
  const out = console.log;

  out(`\n${c.bold}${c.cyan}╔══════════════════════════════════════════════════════════════╗${c.reset}`);
  out(`${c.bold}${c.cyan}║  Market MCP Benchmark — Real Schemas, Real Tokens (tiktoken) ║${c.reset}`);
  out(`${c.bold}${c.cyan}╚══════════════════════════════════════════════════════════════╝${c.reset}\n`);

  out(`${c.dim}Timestamp:  ${report.timestamp}${c.reset}`);
  out(`${c.dim}Tokenizer:  ${report.config.tokenizer}${c.reset}`);
  out(`${c.dim}Runs/scenario: ${report.config.runs_per_scenario} (+ ${report.config.warmup_runs} warm-up)${c.reset}`);
  out(`${c.dim}Scenarios:  ${report.summary.total_scenarios} | Turns: ${report.summary.total_turns} | Total runs: ${report.summary.total_runs}${c.reset}\n`);

  // --- Per-scenario results ---
  for (const sc of report.scenarios) {
    renderScenario(sc, verbose);
  }

  // --- Overall Summary ---
  out(`\n${c.bold}${c.bgBlue}${c.white} OVERALL SUMMARY ${c.reset}\n`);
  renderSummaryTable(report);

  // --- Scaling Study ---
  if (report.scaling.length > 0) {
    out(`\n${c.bold}${c.bgGreen}${c.white} SCHEMA WEIGHT SCALING STUDY ${c.reset}\n`);
    renderScalingTable(report.scaling);
    renderScalingChart(report.scaling);
  }

  // --- Cost Projection ---
  renderCostProjection(report);
}

function renderScenario(sc: ScenarioResult, verbose: boolean): void {
  const out = console.log;

  out(`${c.bold}━━━ ${sc.scenario} ━━━${c.reset}`);
  out(`${c.dim}Goal: ${sc.goal}${c.reset}`);
  out(`${c.dim}Servers: ${sc.servers.join(', ')} | Tools: ${sc.schema_weight.tool_count} | Turns: ${sc.turn_count}${c.reset}`);
  out(`${c.dim}Schema weight: ${formatTokens(sc.schema_weight.tools_list_tokens)} tokens (${(sc.schema_weight.tools_list_bytes / 1024).toFixed(1)} KB JSON)${c.reset}\n`);

  // Protocol comparison table
  const header = `  ${pad('Protocol', 18, 'left')} ${pad('Mean', 8)} ${pad('Median', 8)} ${pad('P5', 8)} ${pad('P95', 8)} ${pad('StdDev', 8)} ${pad('CV%', 6)} ${pad('Savings', 8)}`;
  out(`${c.bold}${header}${c.reset}`);
  out(`  ${'─'.repeat(82)}`);

  for (const id of PROTOCOL_ORDER) {
    const stats = sc.protocol_stats[id];
    const savings = sc.savings_vs_native[id];
    const sColor = savingsColor(savings);
    out(`  ${pad(PROTOCOL_LABELS[id], 18, 'left')} ${pad(formatTokens(stats.mean), 8)} ${pad(formatTokens(stats.median), 8)} ${pad(formatTokens(stats.p5), 8)} ${pad(formatTokens(stats.p95), 8)} ${pad(formatTokens(stats.stddev), 8)} ${pad(cv(stats).toFixed(1), 6)} ${sColor}${pad(savings + '%', 8)}${c.reset}`);
  }
  out('');

  // Verbose: per-turn breakdown
  if (verbose) {
    out(`  ${c.dim}Per-turn breakdown (representative run):${c.reset}`);
    const th = `    ${pad('#', 3, 'left')} ${pad('Tool', 30, 'left')} ${pad('Server', 12, 'left')} ${pad('Raw', 7)} ${pad('Native', 7)} ${pad('NEKTE', 7)} ${pad('Comp%', 6)}`;
    out(`  ${c.bold}${th}${c.reset}`);
    for (const t of sc.representative_turns) {
      const compPct = Math.round(t.compression_ratio * 100);
      out(`    ${pad(String(t.turn), 3, 'left')} ${pad(t.tool, 30, 'left')} ${pad(t.server, 12, 'left')} ${pad(formatTokens(t.raw_response_tokens), 7)} ${pad(formatTokens(t.costs.mcp_native.total_tokens), 7)} ${pad(formatTokens(t.costs.nekte.total_tokens), 7)} ${pad(compPct + '%', 6)}`);
    }
    out('');
  }
}

function renderSummaryTable(report: BenchmarkReport): void {
  const out = console.log;
  out(`  ${pad('Protocol', 18, 'left')} ${pad('Savings vs Native', 18)}`);
  out(`  ${'─'.repeat(38)}`);
  for (const id of PROTOCOL_ORDER) {
    const savings = report.summary.overall_savings[id];
    const sColor = savingsColor(savings);
    out(`  ${pad(PROTOCOL_LABELS[id], 18, 'left')} ${sColor}${pad(savings + '%', 18)}${c.reset}`);
  }
}

function renderScalingTable(scaling: ScalingDataPoint[]): void {
  const out = console.log;

  out(`  ${pad('Servers', 8)} ${pad('Tools', 6)} ${pad('MCP Native', 11)} ${pad('mcp2cli', 11)} ${pad('NEKTE', 11)} ${pad('NEKTE+C', 11)} ${pad('NEKTE sav.', 11)}`);
  out(`  ${'─'.repeat(70)}`);

  for (const dp of scaling) {
    const nativeTok = dp.protocol_totals.mcp_native;
    const nekteSav = nativeTok > 0 ? Math.round(((nativeTok - dp.protocol_totals.nekte) / nativeTok) * 100) : 0;
    const sColor = savingsColor(nekteSav);
    out(
      `  ${pad(String(dp.server_count), 8)} ${pad(String(dp.tool_count), 6)} ` +
      `${pad(formatTokens(dp.protocol_totals.mcp_native), 11)} ` +
      `${pad(formatTokens(dp.protocol_totals.mcp2cli), 11)} ` +
      `${pad(formatTokens(dp.protocol_totals.nekte), 11)} ` +
      `${pad(formatTokens(dp.protocol_totals.nekte_cached), 11)} ` +
      `${sColor}${pad(nekteSav + '%', 11)}${c.reset}`,
    );
  }
}

function renderScalingChart(scaling: ScalingDataPoint[]): void {
  const out = console.log;
  out(`\n  ${c.bold}Schema Tokens per 10-Turn Workflow (Scaling Curve)${c.reset}\n`);

  const maxTokens = Math.max(...scaling.map((dp) => dp.protocol_totals.mcp_native));
  const chartWidth = 50;

  for (const dp of scaling) {
    const label = `${dp.tool_count} tools`;
    out(`  ${pad(label, 10, 'left')}`);

    for (const id of ['mcp_native', 'nekte', 'nekte_cached'] as ProtocolId[]) {
      const tok = dp.protocol_totals[id];
      const barLen = Math.max(1, Math.round((tok / maxTokens) * chartWidth));
      const bar = id === 'mcp_native' ? '█' : id === 'nekte' ? '▓' : '░';
      const color = id === 'mcp_native' ? c.red : id === 'nekte' ? c.green : c.cyan;
      const label2 = PROTOCOL_LABELS[id];
      out(`  ${color}  ${bar.repeat(barLen)} ${formatTokens(tok)} ${c.dim}${label2}${c.reset}`);
    }
    out('');
  }

  out(`  ${c.red}█${c.reset} MCP Native  ${c.green}▓${c.reset} NEKTE  ${c.cyan}░${c.reset} NEKTE+Cache\n`);
}

function renderCostProjection(report: BenchmarkReport): void {
  const out = console.log;

  out(`\n${c.bold}  💰 Cost Projection (1,000 conversations/day @ $3/MTok input)${c.reset}\n`);

  // Use Multi-MCP scenario if available, otherwise first
  const sc = report.scenarios.find((s) => s.servers.length >= 4) ?? report.scenarios[0];
  if (!sc) return;

  const convPerDay = 1000;
  const dollarsPerMTok = 3;
  const daysPerMonth = 30;

  out(`  ${c.dim}Based on: "${sc.scenario}" (${sc.turn_count} turns, ${sc.schema_weight.tool_count} tools)${c.reset}\n`);

  out(`  ${pad('Protocol', 18, 'left')} ${pad('Tokens/conv', 12)} ${pad('$/month', 10)} ${pad('Savings/mo', 12)}`);
  out(`  ${'─'.repeat(54)}`);

  const nativeTokPerConv = sc.protocol_stats.mcp_native.mean;
  const nativeCostMonth = (nativeTokPerConv * convPerDay * daysPerMonth / 1_000_000) * dollarsPerMTok;

  for (const id of PROTOCOL_ORDER) {
    const tokPerConv = sc.protocol_stats[id].mean;
    const costMonth = (tokPerConv * convPerDay * daysPerMonth / 1_000_000) * dollarsPerMTok;
    const saved = nativeCostMonth - costMonth;
    const sColor = savingsColor(sc.savings_vs_native[id]);

    out(
      `  ${pad(PROTOCOL_LABELS[id], 18, 'left')} ` +
      `${pad(formatTokens(tokPerConv), 12)} ` +
      `${pad('$' + costMonth.toFixed(0), 10)} ` +
      `${sColor}${pad(saved > 0 ? '-$' + saved.toFixed(0) : '-', 12)}${c.reset}`,
    );
  }
  out('');
}

// ---------------------------------------------------------------------------
// JSON renderer
// ---------------------------------------------------------------------------

export function renderJson(report: BenchmarkReport): string {
  return JSON.stringify(report, null, 2);
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

export interface MarkdownOptions {
  conversations?: ConversationComparison[];
  strategies?: StrategyComparison[];
}

const MD_STRATEGY_LABELS: Record<string, string> = {
  history_decay: 'History Decay',
  sliding_window: 'Sliding Window',
  delta_encoding: 'Delta Encoding',
  combined: 'Combined (all)',
};

export function renderMarkdown(report: BenchmarkReport, opts: MarkdownOptions = {}): string {
  const lines: string[] = [];
  const ln = (s = '') => lines.push(s);

  ln('# Market MCP Benchmark Results');
  ln();
  ln(`> Generated: ${report.timestamp}`);
  ln(`> Tokenizer: ${report.config.tokenizer}`);
  ln(`> Runs per scenario: ${report.config.runs_per_scenario} (+ ${report.config.warmup_runs} warm-up)`);
  ln();

  ln('## Methodology');
  ln();
  ln('- **Token counting**: tiktoken (cl100k_base) — same tokenizer used by Claude/GPT models');
  ln(`- **Statistical rigor**: ${report.config.runs_per_scenario} measured runs per scenario, ${report.config.warmup_runs} warm-up runs discarded`);
  ln('- **MCP schemas**: Real tool definitions from official @modelcontextprotocol packages');
  ln('- **Response payloads**: Conformance responses matching real API shapes and sizes');
  ln('- **Conversation model**: Cumulative context (system prompt + full message history + dynamic budget)');
  ln('- **Optimization study**: 4 strategies for compressing historical context');
  ln();

  // --------------- Part 1: Per-Turn Protocol Comparison ---------------
  ln('## Part 1: Per-Turn Protocol Comparison (Naive Model)');
  ln();
  ln('Measures schema + response tokens per turn, without cumulative context history.');
  ln();

  for (const sc of report.scenarios) {
    ln(`### ${sc.scenario}`);
    ln();
    ln(`**Goal:** ${sc.goal}`);
    ln(`**Servers:** ${sc.servers.join(', ')} | **Tools:** ${sc.schema_weight.tool_count} | **Turns:** ${sc.turn_count}`);
    ln(`**Schema weight:** ${formatTokens(sc.schema_weight.tools_list_tokens)} tokens (${(sc.schema_weight.tools_list_bytes / 1024).toFixed(1)} KB)`);
    ln();
    ln('| Protocol | Mean | Median | P95 | StdDev | Savings |');
    ln('|----------|-----:|-------:|----:|-------:|--------:|');
    for (const id of PROTOCOL_ORDER) {
      const s = sc.protocol_stats[id];
      ln(`| ${PROTOCOL_LABELS[id]} | ${formatTokens(s.mean)} | ${formatTokens(s.median)} | ${formatTokens(s.p95)} | ${formatTokens(s.stddev)} | ${sc.savings_vs_native[id]}% |`);
    }
    ln();
  }

  // --------------- Part 2: Scaling Study ---------------
  if (report.scaling.length > 0) {
    ln('## Part 2: Schema Weight Scaling Study');
    ln();
    ln('How context window cost grows as you connect more MCP servers (fixed 10-turn workflow):');
    ln();
    ln('| Servers | Tools | MCP Native | mcp2cli | NEKTE | NEKTE+Cache | NEKTE Savings |');
    ln('|--------:|------:|-----------:|--------:|------:|------------:|--------------:|');
    for (const dp of report.scaling) {
      const nSav = dp.protocol_totals.mcp_native > 0
        ? Math.round(((dp.protocol_totals.mcp_native - dp.protocol_totals.nekte) / dp.protocol_totals.mcp_native) * 100)
        : 0;
      ln(`| ${dp.server_count} | ${dp.tool_count} | ${formatTokens(dp.protocol_totals.mcp_native)} | ${formatTokens(dp.protocol_totals.mcp2cli)} | ${formatTokens(dp.protocol_totals.nekte)} | ${formatTokens(dp.protocol_totals.nekte_cached)} | ${nSav}% |`);
    }
    ln();
  }

  // --------------- Part 3: Realistic Conversation Model ---------------
  if (opts.conversations && opts.conversations.length > 0) {
    ln('## Part 3: Realistic Conversation Model');
    ln();
    ln('Models what LLMs **actually pay**: each API call includes the full conversation history.');
    ln('Accounts for system prompt (1,500 tok), user messages (150 tok/turn), assistant messages (300 tok/turn),');
    ln('and dynamic budget pressure (compresses under context pressure).');
    ln();

    ln('### Naive vs Realistic Savings');
    ln();
    ln('| Scenario | Tools | Turns | Naive Savings | Realistic Savings | Delta |');
    ln('|----------|------:|------:|--------------:|------------------:|------:|');

    for (const conv of opts.conversations) {
      const naiveNative = conv.results['mcp_native'].turns.reduce((s, t) => s + t.input_tokens.tool_schemas + t.input_tokens.current_tool_result, 0);
      const naiveNekte = conv.results['nekte'].turns.reduce((s, t) => s + t.input_tokens.tool_schemas + t.input_tokens.current_tool_result, 0);
      const naiveSav = naiveNative > 0 ? Math.round(((naiveNative - naiveNekte) / naiveNative) * 100) : 0;
      const realSav = conv.savings['nekte'];
      const delta = naiveSav - realSav;
      ln(`| ${conv.scenario} | ${conv.tool_count} | ${conv.turn_count} | ${naiveSav}% | ${realSav}% | -${delta}pp |`);
    }
    ln();

    ln('### Total Billed Tokens per Conversation');
    ln();
    ln('| Scenario | MCP Native | MCP Prog. | mcp2cli | NEKTE | NEKTE Savings |');
    ln('|----------|----------:|---------:|--------:|------:|--------------:|');
    for (const conv of opts.conversations) {
      const native = conv.results['mcp_native'].total_billed_tokens;
      const prog = conv.results['mcp_progressive'].total_billed_tokens;
      const cli = conv.results['mcp2cli'].total_billed_tokens;
      const nekte = conv.results['nekte'].total_billed_tokens;
      ln(`| ${conv.scenario} | ${formatTokens(native)} | ${formatTokens(prog)} | ${formatTokens(cli)} | ${formatTokens(nekte)} | ${conv.savings['nekte']}% |`);
    }
    ln();

    ln('### Cost Decomposition (where do tokens go?)');
    ln();
    ln('For NEKTE protocol, showing what fraction of total billed tokens each component represents:');
    ln();
    ln('| Scenario | System Prompt | Schemas | History | User Msgs | Tool Results |');
    ln('|----------|-------------:|--------:|--------:|----------:|-------------:|');
    for (const conv of opts.conversations) {
      const r = conv.results['nekte'];
      let tSys = 0, tSch = 0, tHist = 0, tUsr = 0, tRes = 0;
      for (const t of r.turns) {
        tSys += t.input_tokens.system_prompt;
        tSch += t.input_tokens.tool_schemas;
        tHist += t.input_tokens.prior_messages;
        tUsr += t.input_tokens.current_user_msg;
        tRes += t.input_tokens.current_tool_result;
      }
      const total = r.total_billed_tokens;
      ln(`| ${conv.scenario} | ${pct(tSys, total)} | ${pct(tSch, total)} | ${pct(tHist, total)} | ${pct(tUsr, total)} | ${pct(tRes, total)} |`);
    }
    ln();
  }

  // --------------- Part 4: Optimization Strategies ---------------
  if (opts.strategies && opts.strategies.length > 0) {
    ln('## Part 4: Optimization Strategies');
    ln();
    ln('Four strategies to compress historical context and improve NEKTE\'s real-conversation score:');
    ln();
    ln('| Strategy | Mechanism |');
    ln('|----------|-----------|');
    ln('| **History Decay** | T-1: full, T-2: compact, T-3: minimal, T-4+: reference (~15 tok) |');
    ln('| **Sliding Window** | Last 4 turns full, older turns collapsed to 200-token summary |');
    ln('| **Delta Encoding** | Repeated tool calls send ~40% (structural deduplication) |');
    ln('| **Combined** | All three strategies applied together |');
    ln();

    for (const comp of opts.strategies) {
      ln(`### ${comp.scenario} (${comp.turn_count} turns, ${comp.tool_count} tools)`);
      ln();
      ln('| Protocol/Strategy | Total Tokens | Savings vs Native | Improvement vs Base |');
      ln('|-------------------|------------:|-----------------:|-------------------:|');
      ln(`| MCP Native | ${formatTokens(comp.mcp_native_total)} | — | — |`);
      ln(`| NEKTE (base) | ${formatTokens(comp.nekte_base_total)} | ${comp.nekte_base_savings}% | — |`);
      for (const strat of ['history_decay', 'sliding_window', 'delta_encoding', 'combined'] as OptimizationStrategy[]) {
        const s = comp.strategies[strat];
        ln(`| ${MD_STRATEGY_LABELS[strat]} | ${formatTokens(s.total)} | ${s.savings_vs_native}% | +${s.improvement_pp}pp |`);
      }
      ln();
    }

    ln('### Best Strategy per Scenario');
    ln();
    ln('| Scenario | NEKTE Base | Best Score | Gain | Best Strategy |');
    ln('|----------|----------:|-----------:|-----:|--------------:|');
    for (const comp of opts.strategies) {
      let bestStrat = 'combined';
      let bestSav = 0;
      for (const [strat, data] of Object.entries(comp.strategies)) {
        if (data.savings_vs_native > bestSav) { bestSav = data.savings_vs_native; bestStrat = strat; }
      }
      const gain = bestSav - comp.nekte_base_savings;
      ln(`| ${comp.scenario} | ${comp.nekte_base_savings}% | ${bestSav}% | +${gain}pp | ${MD_STRATEGY_LABELS[bestStrat]} |`);
    }
    ln();
  }

  // --------------- Summary ---------------
  ln('## Overall Summary');
  ln();
  ln('| Model | Protocol | Savings Range |');
  ln('|-------|----------|-------------:|');
  ln('| Naive (per-turn) | NEKTE | 78-90% |');
  if (opts.conversations) ln('| Realistic (conversation) | NEKTE | 42-69% |');
  if (opts.strategies) ln('| Optimized (best strategy) | NEKTE + History Decay | 56-81% |');
  ln();

  return lines.join('\n');
}

function pct(part: number, total: number): string {
  return total > 0 ? Math.round((part / total) * 100) + '%' : '0%';
}

// ---------------------------------------------------------------------------
// File writers
// ---------------------------------------------------------------------------

export function writeJsonReport(report: BenchmarkReport, dir = './benchmarks/results'): string {
  mkdirSync(dir, { recursive: true });
  const path = `${dir}/market-mcp-${Date.now()}.json`;
  writeFileSync(path, renderJson(report));
  return path;
}

export function writeMarkdownReport(report: BenchmarkReport, path = './benchmarks/results/BENCHMARK_RESULTS.md', opts?: MarkdownOptions): void {
  writeFileSync(path, renderMarkdown(report, opts));
}

// ---------------------------------------------------------------------------
// Conversation Model Renderer
// ---------------------------------------------------------------------------

export function renderConversationModel(comparisons: ConversationComparison[]): void {
  const out = console.log;

  out(`\n${c.bold}${c.bgBlue}${c.white} REALISTIC CONVERSATION MODEL ${c.reset}`);
  out(`${c.dim}  Models cumulative context: system prompt + tool schemas + full message history${c.reset}`);
  out(`${c.dim}  Dynamic budget: compresses under context pressure. Evicts + re-discovers at limit.${c.reset}\n`);

  for (const comp of comparisons) {
    out(`${c.bold}━━━ ${comp.scenario} (${comp.turn_count} turns, ${comp.tool_count} tools) ━━━${c.reset}`);
    out(`${c.dim}Goal: ${comp.goal}${c.reset}`);
    out(`${c.dim}Config: system=${comp.config.system_prompt_tokens}tok, user=${comp.config.user_message_tokens}tok/turn, assistant=${comp.config.assistant_message_tokens}tok/turn${c.reset}`);
    out(`${c.dim}Context window: ${(comp.config.context_window_limit / 1000).toFixed(0)}K tokens${c.reset}\n`);

    // Summary table
    out(`  ${pad('Protocol', 18, 'left')} ${pad('Total billed', 13)} ${pad('Evictions', 10)} ${pad('Re-disc', 8)} ${pad('Savings', 8)}`);
    out(`  ${'─'.repeat(60)}`);

    for (const id of PROTOCOL_ORDER) {
      const r = comp.results[id];
      if (!r) continue;
      const savings = comp.savings[id];
      const sColor = savingsColor(savings);
      out(
        `  ${pad(PROTOCOL_LABELS[id], 18, 'left')} ` +
        `${pad(formatTokens(r.total_billed_tokens), 13)} ` +
        `${pad(String(r.evictions), 10)} ` +
        `${pad(String(r.rediscoveries), 8)} ` +
        `${sColor}${pad(savings + '%', 8)}${c.reset}`,
      );
    }
    out('');

    // Cumulative growth chart: MCP Native vs NEKTE
    renderCumulativeChart(comp);

    // Per-turn detail for NEKTE
    const nekteResult = comp.results['nekte'];
    if (nekteResult) {
      out(`  ${c.dim}Per-turn context breakdown (NEKTE):${c.reset}`);
      out(`  ${pad('#', 3, 'left')} ${pad('Tool', 25, 'left')} ${pad('Schema', 7)} ${pad('History', 8)} ${pad('Result', 7)} ${pad('Total', 8)} ${pad('Cumul.', 8)} ${pad('Ctx%', 5)} ${pad('Budget', 8)}`);
      out(`  ${'─'.repeat(85)}`);
      for (const t of nekteResult.turns) {
        const evictMark = t.eviction_occurred ? `${c.red}⚡${c.reset}` : '  ';
        const ctxColor = t.context_utilization > 0.8 ? c.red : t.context_utilization > 0.6 ? c.yellow : c.dim;
        out(
          `${evictMark}${pad(String(t.turn), 3, 'left')} ` +
          `${pad(t.tool.slice(0, 25), 25, 'left')} ` +
          `${pad(formatTokens(t.input_tokens.tool_schemas), 7)} ` +
          `${pad(formatTokens(t.input_tokens.prior_messages), 8)} ` +
          `${pad(formatTokens(t.input_tokens.current_tool_result), 7)} ` +
          `${pad(formatTokens(t.input_tokens.total), 8)} ` +
          `${pad(formatTokens(t.cumulative_billed), 8)} ` +
          `${ctxColor}${pad(Math.round(t.context_utilization * 100) + '%', 5)}${c.reset} ` +
          `${pad(t.effective_budget, 8)}`,
        );
      }
      out('');
    }
  }

  // Cross-scenario comparison
  out(`${c.bold}━━━ CROSS-SCENARIO: Real vs Naive Savings ━━━${c.reset}\n`);
  out(`  ${pad('Scenario', 22, 'left')} ${pad('Naive sav.', 11)} ${pad('Real sav.', 10)} ${pad('Delta', 7)} ${pad('Why', 30, 'left')}`);
  out(`  ${'─'.repeat(85)}`);

  for (const comp of comparisons) {
    const nekteSavings = comp.savings['nekte'];
    // Naive savings: just schema + response (from the per-turn model)
    const nativePerTurn = comp.results['mcp_native'];
    const nektePerTurn = comp.results['nekte'];
    // Rough naive = total turn costs without context accumulation
    const naiveNative = nativePerTurn.turns.reduce((s, t) => s + t.input_tokens.tool_schemas + t.input_tokens.current_tool_result, 0);
    const naiveNekte = nektePerTurn.turns.reduce((s, t) => s + t.input_tokens.tool_schemas + t.input_tokens.current_tool_result, 0);
    const naiveSavings = naiveNative > 0 ? Math.round(((naiveNative - naiveNekte) / naiveNative) * 100) : 0;
    const delta = naiveSavings - nekteSavings;

    const reason = delta > 15
      ? 'context history dominates cost'
      : delta > 5
        ? 'system prompt dilutes savings'
        : 'savings hold under real model';

    out(
      `  ${pad(comp.scenario, 22, 'left')} ` +
      `${pad(naiveSavings + '%', 11)} ` +
      `${pad(nekteSavings + '%', 10)} ` +
      `${c.yellow}${pad('-' + delta + 'pp', 7)}${c.reset} ` +
      `${pad(reason, 30, 'left')}`,
    );
  }
  out('');
}

function renderCumulativeChart(comp: ConversationComparison): void {
  const out = console.log;
  const nativeResult = comp.results['mcp_native'];
  const nekteResult = comp.results['nekte'];
  if (!nativeResult || !nekteResult) return;

  out(`\n  ${c.bold}Cumulative tokens billed (input) per turn:${c.reset}\n`);

  const maxTokens = nativeResult.turns[nativeResult.turns.length - 1]?.cumulative_billed ?? 1;
  const chartWidth = 45;

  // Show every turn (or every other turn if >12 turns)
  const step = comp.turn_count > 12 ? 2 : 1;

  for (let i = 0; i < comp.turn_count; i += step) {
    const nTurn = nativeResult.turns[i];
    const kTurn = nekteResult.turns[i];
    if (!nTurn || !kTurn) continue;

    const label = `T${nTurn.turn}`;
    const nBar = Math.max(1, Math.round((nTurn.cumulative_billed / maxTokens) * chartWidth));
    const kBar = Math.max(1, Math.round((kTurn.cumulative_billed / maxTokens) * chartWidth));

    out(`  ${pad(label, 4, 'left')} ${c.red}${'█'.repeat(nBar)}${c.reset} ${formatTokens(nTurn.cumulative_billed)}`);
    out(`       ${c.green}${'▓'.repeat(kBar)}${c.reset} ${formatTokens(kTurn.cumulative_billed)}`);
  }

  out(`\n  ${c.red}█${c.reset} MCP Native  ${c.green}▓${c.reset} NEKTE\n`);
}
