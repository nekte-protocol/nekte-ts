import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ReportRenderer } from '../../ports.js';
import type { BenchmarkReport } from '../../domain/report.js';

export class JsonReportRenderer implements ReportRenderer {
  constructor(private outputDir: string = '.') {}

  render(report: BenchmarkReport): string {
    const json = JSON.stringify(report, null, 2);
    mkdirSync(this.outputDir, { recursive: true });
    const path = join(this.outputDir, `nekte-benchmark-${Date.now()}.json`);
    writeFileSync(path, json);
    console.log(`  JSON report: ${path}`);
    return json;
  }
}
