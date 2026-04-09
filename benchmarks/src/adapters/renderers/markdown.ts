import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ReportRenderer } from '../../ports.js';
import type { BenchmarkReport, ProtocolId } from '../../domain/report.js';

export class MarkdownReportRenderer implements ReportRenderer {
  constructor(private outputDir: string = '.') {}

  render(report: BenchmarkReport): string {
    const protocols: ProtocolId[] = ['mcp-native', 'mcp-progressive', 'mcp2cli', 'nekte'];
    const lines: string[] = [];

    lines.push('# NEKTE Benchmark Results');
    lines.push('');
    lines.push(`Seed: ${report.seed} | Cost assumption: $${report.costPerMTok}/MTok | Generated: ${report.timestamp}`);
    lines.push('');
    lines.push('| Scenario | ' + protocols.join(' | ') + ' | vs MCP |');
    lines.push('|----------|' + protocols.map(() => '---').join('|') + '|--------|');

    for (const result of report.scenarios) {
      const mcpCost = result.costs['mcp-native']?.totalTokens ?? 0;
      const nekteCost = result.costs['nekte']?.totalTokens ?? 0;
      const pct = mcpCost > 0 ? `-${Math.round(((mcpCost - nekteCost) / mcpCost) * 100)}%` : 'N/A';

      const row = `| ${result.scenario.name} | ` +
        protocols.map((p) => {
          const cost = result.costs[p];
          return cost ? cost.totalTokens.toLocaleString() : 'N/A';
        }).join(' | ') +
        ` | ${pct} |`;

      lines.push(row);
    }

    const md = lines.join('\n') + '\n';
    mkdirSync(this.outputDir, { recursive: true });
    const path = join(this.outputDir, 'BENCHMARK_RESULTS.md');
    writeFileSync(path, md);
    console.log(`  Markdown report: ${path}`);
    return md;
  }
}
