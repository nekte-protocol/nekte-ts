import type { ReportRenderer } from '../../ports.js';
import type { BenchmarkReport, ProtocolId } from '../../domain/report.js';

export class TerminalTableRenderer implements ReportRenderer {
  render(report: BenchmarkReport): void {
    const protocols: ProtocolId[] = ['mcp-native', 'mcp-progressive', 'mcp2cli', 'nekte', 'nekte-cached'];
    const colW = 14;

    console.log('\n' + '='.repeat(100));
    console.log('  NEKTE Benchmark Suite v0.3');
    console.log('  Seed: ' + report.seed + ' | Cost: $' + report.costPerMTok + '/MTok');
    console.log('='.repeat(100));

    // Header
    const header = '  Scenario'.padEnd(22) + protocols.map((p) => p.padStart(colW)).join('');
    console.log(header);
    console.log('  ' + '-'.repeat(96));

    for (const result of report.scenarios) {
      const row = `  ${result.scenario.name}`.padEnd(22) +
        protocols.map((p) => {
          const cost = result.costs[p];
          return cost ? String(Math.round(cost.totalTokens)).padStart(colW) : 'N/A'.padStart(colW);
        }).join('');
      console.log(row);
    }

    // Savings summary
    console.log('\n  Savings vs MCP native:');
    for (const result of report.scenarios) {
      const mcpCost = result.costs['mcp-native']?.totalTokens ?? 0;
      const nekteCost = result.costs['nekte']?.totalTokens ?? 0;
      const pct = mcpCost > 0 ? Math.round(((mcpCost - nekteCost) / mcpCost) * 100) : 0;
      console.log(`    ${result.scenario.name.padEnd(24)} -${pct}%`);
    }

    // Enterprise cost estimate
    const enterprise = report.scenarios.find((s) => s.scenario.name === 'Enterprise');
    if (enterprise) {
      const mcpTokens = enterprise.costs['mcp-native']?.totalTokens ?? 0;
      const nekteTokens = enterprise.costs['nekte']?.totalTokens ?? 0;
      const dailyConv = 1000;
      const mcpMonthly = (mcpTokens * dailyConv * 30 * report.costPerMTok) / 1_000_000;
      const nekteMonthly = (nekteTokens * dailyConv * 30 * report.costPerMTok) / 1_000_000;
      console.log(`\n  Enterprise cost (1K conv/day):`);
      console.log(`    MCP:   $${mcpMonthly.toFixed(0)}/month`);
      console.log(`    NEKTE: $${nekteMonthly.toFixed(0)}/month`);
      console.log(`    Saved: $${(mcpMonthly - nekteMonthly).toFixed(0)}/month`);
    }

    console.log('');
  }
}
