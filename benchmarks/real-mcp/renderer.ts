/**
 * Terminal Renderer for Real-World MCP Benchmark Results
 *
 * Displays per-scenario and per-turn token costs across 4 protocols:
 * MCP native, mcp2cli, MCP progressive, and NEKTE.
 */

import type { BenchmarkReport, ScenarioResult, ProtocolId } from './runner.js';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

const PROTOCOLS: { id: ProtocolId; label: string }[] = [
  { id: 'mcp_native', label: 'MCP native' },
  { id: 'mcp2cli', label: 'mcp2cli' },
  { id: 'mcp_progressive', label: 'MCP prog.' },
  { id: 'nekte', label: 'NEKTE' },
  { id: 'nekte_optimized', label: 'NEKTE+opt' },
];

function pad(s: string | number, w: number, align: 'left' | 'right' = 'right'): string {
  const str = String(s);
  return align === 'right' ? str.padStart(w) : str.padEnd(w);
}

function pct(n: number): string {
  if (n === 0) return '  base';
  return `${n >= 0 ? '-' : '+'}${Math.abs(n)}%`;
}

function tok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function saveColor(n: number): string {
  if (n >= 90) return GREEN;
  if (n >= 50) return YELLOW;
  if (n > 0) return YELLOW;
  return DIM;
}

export function renderReport(report: BenchmarkReport, verbose = false): void {
  const W = 112;

  console.log();
  console.log(`${BOLD}${'='.repeat(W)}${RESET}`);
  console.log(`${BOLD}  NEKTE Real-World MCP Benchmark${RESET}`);
  console.log(`  ${DIM}${report.timestamp} | 4 protocols compared on real MCP server data${RESET}`);
  console.log(`${BOLD}${'='.repeat(W)}${RESET}`);

  for (const result of report.scenarios) {
    renderScenario(result, verbose);
  }

  renderSummaryTable(report);
  renderCostProjection(report);
}

function renderScenario(result: ScenarioResult, verbose: boolean): void {
  const W = 112;
  const colW = 12;

  console.log();
  console.log(`${BOLD}${CYAN}  ${result.scenario}${RESET}  ${DIM}(${result.servers.join(' + ')}, ${result.turns.length} turns)${RESET}`);
  console.log(`  ${DIM}${result.goal}${RESET}`);
  console.log(`  ${DIM}${result.mcp_schema_weight.tool_count} tools | ${tok(result.mcp_schema_weight.all_schemas_tokens)} tok schema weight${RESET}`);
  console.log(`  ${'-'.repeat(W - 2)}`);

  if (verbose) {
    // Per-turn detail
    const hdr =
      pad('#', 3) + '  ' +
      pad('Tool', 24, 'left') +
      PROTOCOLS.map((p) => pad(p.label, colW)).join('') +
      pad('Resp', 8);
    console.log(`  ${DIM}${hdr}${RESET}`);

    for (const t of result.turns) {
      const toolName = t.tool.length > 22 ? t.tool.slice(0, 21) + '~' : t.tool;
      const row =
        pad(t.turn, 3) + '  ' +
        pad(toolName, 24, 'left') +
        PROTOCOLS.map((p) => {
          const cost = t[p.id];
          const sv = t.mcp_native.total_tokens > 0
            ? Math.round(((t.mcp_native.total_tokens - cost.total_tokens) / t.mcp_native.total_tokens) * 100)
            : 0;
          const c = p.id === 'mcp_native' ? DIM : saveColor(sv);
          return `${c}${pad(tok(cost.total_tokens), colW)}${RESET}`;
        }).join('') +
        `${DIM}${pad(tok(t.raw_response_tokens), 8)}${RESET}`;
      console.log(`  ${row}`);
    }

    console.log();
  }

  // Scenario totals row
  console.log(`  ${BOLD}Totals (tokens):${RESET}`);
  for (const p of PROTOCOLS) {
    const t = result.totals[p.id];
    const sv = result.savings[p.id];
    const c = p.id === 'mcp_native' ? '' : saveColor(sv);
    const saveTxt = p.id === 'mcp_native' ? `${DIM}(baseline)${RESET}` : `${c}${BOLD}${pct(sv)}${RESET}`;
    console.log(`    ${pad(p.label, 14, 'left')} ${pad(tok(t.total_tokens), 8)}  ${DIM}(schema: ${tok(t.schema_tokens)} + resp: ${tok(t.response_tokens)})${RESET}  ${saveTxt}`);
  }
}

function renderSummaryTable(report: BenchmarkReport): void {
  const W = 112;
  const colW = 14;

  console.log();
  console.log(`${BOLD}${'='.repeat(W)}${RESET}`);
  console.log(`${BOLD}  Comparison Table${RESET}  ${DIM}(${report.summary.total_turns} turns across ${report.scenarios.length} scenarios)${RESET}`);
  console.log(`${'='.repeat(W)}`);

  // Header
  const header = pad('Scenario', 20, 'left') + PROTOCOLS.map((p) => pad(p.label, colW)).join('');
  console.log(`  ${DIM}${header}${RESET}`);
  console.log(`  ${'-'.repeat(W - 2)}`);

  // Per-scenario
  for (const result of report.scenarios) {
    const row = pad(result.scenario, 20, 'left') +
      PROTOCOLS.map((p) => {
        const sv = result.savings[p.id];
        const c = p.id === 'mcp_native' ? '' : saveColor(sv);
        return `${c}${pad(tok(result.totals[p.id].total_tokens), colW)}${RESET}`;
      }).join('');
    console.log(`  ${row}`);
  }

  // Total
  console.log(`  ${'-'.repeat(W - 2)}`);
  const totalRow = `${BOLD}${pad('TOTAL', 20, 'left')}${RESET}` +
    PROTOCOLS.map((p) => {
      const sv = report.summary.savings_vs_native[p.id];
      const c = p.id === 'mcp_native' ? '' : saveColor(sv);
      return `${c}${BOLD}${pad(tok(report.summary.totals[p.id]), colW)}${RESET}`;
    }).join('');
  console.log(`  ${totalRow}`);

  // Savings row
  const savingsRow = pad('vs native', 20, 'left') +
    PROTOCOLS.map((p) => {
      const sv = report.summary.savings_vs_native[p.id];
      const c = p.id === 'mcp_native' ? DIM : saveColor(sv);
      return `${c}${pad(pct(sv), colW)}${RESET}`;
    }).join('');
  console.log(`  ${savingsRow}`);
}

function renderCostProjection(report: BenchmarkReport): void {
  const W = 112;
  const COST_PER_MTOK = 3; // $3/MTok
  const DAILY_CONV = 1000;
  const colW = 14;

  console.log();
  console.log(`${BOLD}  Cost Projection${RESET}  ${DIM}(at $${COST_PER_MTOK}/MTok, ${DAILY_CONV.toLocaleString()} conversations/day)${RESET}`);
  console.log(`  ${'-'.repeat(W - 2)}`);

  // Header
  const header = pad('', 20, 'left') + PROTOCOLS.map((p) => pad(p.label, colW)).join('');
  console.log(`  ${DIM}${header}${RESET}`);

  // Avg tokens per conversation
  const nScenarios = report.scenarios.length;
  const avgRow = pad('Avg tok/conv', 20, 'left') +
    PROTOCOLS.map((p) => pad(tok(Math.round(report.summary.totals[p.id] / nScenarios)), colW)).join('');
  console.log(`  ${avgRow}`);

  // Monthly cost
  const monthlyCosts: Record<string, number> = {};
  const monthlyRow = pad('$/month', 20, 'left') +
    PROTOCOLS.map((p) => {
      const avg = report.summary.totals[p.id] / nScenarios;
      const monthly = (avg * DAILY_CONV * 30 * COST_PER_MTOK) / 1_000_000;
      monthlyCosts[p.id] = monthly;
      const c = p.id === 'mcp_native' ? RED : p.id === 'nekte' ? GREEN : YELLOW;
      return `${c}${pad(`$${monthly.toFixed(0)}`, colW)}${RESET}`;
    }).join('');
  console.log(`  ${BOLD}${monthlyRow}${RESET}`);

  // Savings vs native
  const nativeMonthly = monthlyCosts['mcp_native'];
  const savedRow = pad('Saved/month', 20, 'left') +
    PROTOCOLS.map((p) => {
      if (p.id === 'mcp_native') return pad('-', colW);
      const saved = nativeMonthly - monthlyCosts[p.id];
      return `${GREEN}${pad(`$${saved.toFixed(0)}`, colW)}${RESET}`;
    }).join('');
  console.log(`  ${savedRow}`);

  // NEKTE vs mcp2cli specifically
  const nekteMonthly = monthlyCosts['nekte'];
  const cliMonthly = monthlyCosts['mcp2cli'];
  if (cliMonthly > nekteMonthly) {
    const extraSavings = cliMonthly - nekteMonthly;
    const extraPct = Math.round((extraSavings / cliMonthly) * 100);
    console.log();
    console.log(`  ${BOLD}NEKTE vs mcp2cli:${RESET}  ${GREEN}$${extraSavings.toFixed(0)}/month${RESET} additional savings (${GREEN}-${extraPct}%${RESET})`);
    console.log(`  ${DIM}mcp2cli saves on schemas but sends full responses. NEKTE compresses both.${RESET}`);
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Information Retention Report
// ---------------------------------------------------------------------------

function retentionColor(score: number): string {
  if (score >= 80) return GREEN;
  if (score >= 50) return YELLOW;
  return RED;
}

export function renderRetentionReport(report: BenchmarkReport): void {
  const W = 112;

  console.log(`${BOLD}${'='.repeat(W)}${RESET}`);
  console.log(`${BOLD}  Information Retention Analysis${RESET}`);
  console.log(`  ${DIM}Does NEKTE compression lose data the agent needs?${RESET}`);
  console.log(`${'='.repeat(W)}`);

  for (const result of report.scenarios) {
    console.log();
    console.log(`${BOLD}${CYAN}  ${result.scenario}${RESET}`);
    console.log(`  ${'-'.repeat(W - 2)}`);

    // Per-turn retention table
    const hdr =
      pad('#', 3) + '  ' +
      pad('Tool', 22, 'left') +
      pad('Budget', 8) +
      pad('Score', 7) +
      pad('Keys%', 7) +
      pad('Vals%', 7) +
      pad('Arr%', 6) +
      pad('Depth', 7) +
      pad('Tok save', 9) +
      '  Critical missing';
    console.log(`  ${DIM}${hdr}${RESET}`);

    for (const t of result.turns) {
      const r = t.retention;
      const sc = retentionColor(r.retention_score);
      const toolName = t.tool.length > 20 ? t.tool.slice(0, 19) + '~' : t.tool;
      const tokSave = t.raw_response_tokens > 0
        ? `-${Math.round((1 - t.compression_ratio) * 100)}%`
        : '-';
      const missing = r.critical_fields_missing.length > 0
        ? `${RED}${r.critical_fields_missing.join(', ')}${RESET}`
        : `${GREEN}none${RESET}`;

      const row =
        pad(t.turn, 3) + '  ' +
        pad(toolName, 22, 'left') +
        pad(r.budget, 8) +
        `${sc}${pad(r.retention_score, 7)}${RESET}` +
        pad(r.keys_retained_pct, 7) +
        pad(r.values_retained_pct, 7) +
        pad(r.array_items_retained_pct, 6) +
        pad(`${r.depth_retained}/${r.depth_original}`, 7) +
        pad(tokSave, 9) +
        '  ' + missing;
      console.log(`  ${row}`);
    }

    // Scenario average
    const avgScore = Math.round(
      result.turns.reduce((s, t) => s + t.retention.retention_score, 0) / result.turns.length,
    );
    const avgKeys = Math.round(
      result.turns.reduce((s, t) => s + t.retention.keys_retained_pct, 0) / result.turns.length,
    );
    const avgVals = Math.round(
      result.turns.reduce((s, t) => s + t.retention.values_retained_pct, 0) / result.turns.length,
    );
    const totalCritMissing = result.turns.reduce(
      (s, t) => s + t.retention.critical_fields_missing.length, 0,
    );
    const totalCritPresent = result.turns.reduce(
      (s, t) => s + t.retention.critical_fields_present.length, 0,
    );
    const sc = retentionColor(avgScore);
    console.log(`  ${'-'.repeat(W - 2)}`);
    console.log(`  ${BOLD}Avg:${RESET} Score ${sc}${BOLD}${avgScore}/100${RESET}  Keys ${avgKeys}%  Values ${avgVals}%  Critical: ${totalCritPresent} preserved, ${totalCritMissing > 0 ? RED : GREEN}${totalCritMissing} lost${RESET}`);
  }

  // Overall assessment
  console.log();
  console.log(`${BOLD}${'='.repeat(W)}${RESET}`);
  console.log(`${BOLD}  Verdict: Savings vs Information Loss${RESET}`);
  console.log(`${'='.repeat(W)}`);

  const allTurns = report.scenarios.flatMap((s) => s.turns);
  const byBudget = new Map<string, typeof allTurns>();
  for (const t of allTurns) {
    const b = t.retention.budget;
    if (!byBudget.has(b)) byBudget.set(b, []);
    byBudget.get(b)!.push(t);
  }

  for (const [budget, turns] of byBudget) {
    const avgScore = Math.round(turns.reduce((s, t) => s + t.retention.retention_score, 0) / turns.length);
    const avgSave = Math.round(turns.reduce((s, t) => s + (1 - t.compression_ratio), 0) / turns.length * 100);
    const critMissing = turns.reduce((s, t) => s + t.retention.critical_fields_missing.length, 0);
    const sc = retentionColor(avgScore);

    console.log();
    console.log(`  ${BOLD}budget: ${budget}${RESET}  (${turns.length} turns)`);
    console.log(`    Retention score: ${sc}${BOLD}${avgScore}/100${RESET}`);
    console.log(`    Token savings:   ${GREEN}-${avgSave}%${RESET}`);
    console.log(`    Critical lost:   ${critMissing > 0 ? `${RED}${critMissing} fields` : `${GREEN}0 fields`}${RESET}`);

    if (budget === 'minimal' && avgScore < 50) {
      console.log(`    ${YELLOW}Warning: minimal budget loses significant data. Use for fire-and-forget ops only.${RESET}`);
    }
    if (budget === 'compact' && critMissing === 0) {
      console.log(`    ${GREEN}Compact preserves all critical fields — safe for most agent decisions.${RESET}`);
    }
    if (budget === 'full') {
      console.log(`    ${DIM}Full budget = no compression. Use when agent needs complete data.${RESET}`);
    }
  }

  console.log();
}

export function reportToJson(report: BenchmarkReport): string {
  return JSON.stringify(report, null, 2);
}
