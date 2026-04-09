#!/usr/bin/env tsx
/**
 * NEKTE E2E Performance Benchmark Suite
 *
 * Comprehensive end-to-end benchmarks measuring real protocol performance:
 * transport throughput, SSE streaming, protocol flows, cache effectiveness,
 * and multi-agent concurrency.
 *
 * Usage:
 *   pnpm benchmark:e2e              # Full suite
 *   pnpm benchmark:e2e --fast       # Quick mode (reduced runs)
 *   pnpm benchmark:e2e --json       # JSON output
 *   pnpm benchmark:e2e --only transport,cache
 */

import { runTransportThroughput } from './transport-throughput.js';
import { runSseStreaming, type StreamingResult } from './sse-streaming.js';
import { runProtocolFlows, type FlowResult } from './protocol-flows.js';
import { runCacheEffectiveness, type CacheComparisonResult } from './cache-effectiveness.js';
import { runMultiAgent, type MultiAgentResult } from './multi-agent.js';
import type { MetricsSnapshot } from './lib/metrics.js';

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2).filter((a) => a !== '--');
const fast = args.includes('--fast');
const jsonOutput = args.includes('--json');
const onlyIdx = args.indexOf('--only');
const onlyArg = args.find((a) => a.startsWith('--only='))?.split('=')[1] ?? (onlyIdx >= 0 ? args[onlyIdx + 1] : undefined);
const only = onlyArg?.split(',').filter(Boolean) ?? [];

function shouldRun(name: string): boolean {
  return only.length === 0 || only.some((o) => name.includes(o));
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtMs(ms: number): string {
  if (ms < 0.01) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function pad(s: string, n: number): string { return s.padEnd(n); }
function rpad(s: string, n: number): string { return s.padStart(n); }

function printLatency(label: string, snap: MetricsSnapshot, indent = '  '): void {
  const l = snap.latency;
  const mem = snap.memory_delta_mb;
  console.log(
    `${indent}${pad(label, 36)} ${rpad(fmtNum(l.count), 7)} req  ${rpad(fmtNum(snap.throughput_rps), 6)}/s` +
    `  P50=${rpad(fmtMs(l.p50_ms), 7)}  P95=${rpad(fmtMs(l.p95_ms), 7)}  P99=${rpad(fmtMs(l.p99_ms), 7)}` +
    `  ELU=${snap.elu_pct}%  Mem=${mem > 0 ? '+' : ''}${mem.toFixed(1)}MB`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startTime = performance.now();

  console.log('');
  console.log('\x1b[1m\x1b[36m╔══════════════════════════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[1m\x1b[36m║  NEKTE E2E Performance Benchmark Suite                       ║\x1b[0m');
  console.log('\x1b[1m\x1b[36m╚══════════════════════════════════════════════════════════════╝\x1b[0m');
  console.log('');
  console.log(`\x1b[2m  Mode: ${fast ? 'fast' : 'full'} | Output: ${jsonOutput ? 'JSON' : 'terminal'}\x1b[0m`);
  console.log('');

  const allResults: Record<string, unknown> = {};

  // ─── 1. Transport Throughput ───────────────────────────────────────────
  if (shouldRun('transport')) {
    console.log('\x1b[1m━━━ Transport Throughput (HTTP) ━━━\x1b[0m');
    console.log('\x1b[2m  Open-loop scheduling, HDR histogram latency, CO-corrected\x1b[0m');
    console.log('');

    const results = await runTransportThroughput({
      rate: fast ? 200 : 500,
      durationSec: fast ? 3 : 5,
      warmupSec: fast ? 1 : 2,
    });

    for (const [name, snap] of results) {
      printLatency(name, snap);
    }
    console.log('');

    // MCP comparison note
    console.log('\x1b[2m  Reference: MCP Node.js baseline = 559 RPS, 10.66ms avg, 53.24ms P95 (TM Dev Lab 2026)\x1b[0m');
    console.log('');

    allResults.transport = Object.fromEntries(results);
  }

  // ─── 2. SSE Streaming ─────────────────────────────────────────────────
  if (shouldRun('streaming')) {
    console.log('\x1b[1m━━━ SSE Streaming (nekte.delegate) ━━━\x1b[0m');
    console.log('\x1b[2m  Concurrent delegate streams: TTFE, inter-event latency, memory scaling\x1b[0m');
    console.log('');

    const levels = fast ? [1, 10, 50] : [1, 10, 50, 100];
    const results = await runSseStreaming(levels);

    console.log(`  ${pad('Concurrency', 14)} ${rpad('Streams', 8)} ${rpad('TTFE P50', 10)} ${rpad('TTFE P99', 10)} ${rpad('IEvt P50', 10)} ${rpad('Mem/str', 10)} ${rpad('Events', 8)}`);
    console.log('  ' + '─'.repeat(76));

    for (const r of results) {
      console.log(
        `  ${pad(r.concurrency + ' streams', 14)} ${rpad(r.streams_completed + '/' + r.concurrency, 8)}` +
        ` ${rpad(fmtMs(r.ttfe.latency.p50_ms), 10)} ${rpad(fmtMs(r.ttfe.latency.p99_ms), 10)}` +
        ` ${rpad(fmtMs(r.inter_event.latency.p50_ms), 10)} ${rpad(r.memory_per_stream_kb + 'KB', 10)}` +
        ` ${rpad(String(r.total_events), 8)}`,
      );
    }
    console.log('');

    allResults.streaming = results;
  }

  // ─── 3. Protocol Flows ────────────────────────────────────────────────
  if (shouldRun('flows')) {
    console.log('\x1b[1m━━━ Protocol Flow Pipelines (E2E) ━━━\x1b[0m');
    console.log('\x1b[2m  Complete multi-step protocol sequences, measured end-to-end\x1b[0m');
    console.log('');

    const results = await runProtocolFlows(fast ? 30 : 100);

    for (const flow of results) {
      const l = flow.latency.latency;
      console.log(`  \x1b[1m${flow.name}\x1b[0m`);
      console.log(`  \x1b[2m${flow.description}\x1b[0m`);
      console.log(`    Total:  P50=${fmtMs(l.p50_ms)}  P95=${fmtMs(l.p95_ms)}  P99=${fmtMs(l.p99_ms)}`);

      // Step breakdown
      const steps = Object.entries(flow.step_breakdown_ms);
      if (steps.length > 1) {
        const parts = steps.map(([k, v]) => `${k}=${fmtMs(v)}`).join('  ');
        console.log(`    Steps:  ${parts}`);
      }
      console.log('');
    }

    allResults.flows = results;
  }

  // ─── 4. Cache Effectiveness ───────────────────────────────────────────
  if (shouldRun('cache')) {
    console.log('\x1b[1m━━━ Cache Effectiveness (SIEVE vs LRU vs FIFO) ━━━\x1b[0m');
    console.log('\x1b[2m  Real access patterns: Zipfian, scan, temporal shift\x1b[0m');
    console.log('');

    const results = await runCacheEffectiveness();

    console.log(`  ${pad('Pattern', 30)} ${rpad('SIEVE', 9)} ${rpad('LRU', 9)} ${rpad('FIFO', 9)} ${rpad('SIEVE win', 10)}`);
    console.log('  ' + '─'.repeat(70));

    for (const r of results) {
      const sieveWin = (r.sieve.hit_rate_pct - r.lru.hit_rate_pct).toFixed(1);
      const tag = Number(sieveWin) > 0 ? `\x1b[32m+${sieveWin}pp\x1b[0m` : `\x1b[31m${sieveWin}pp\x1b[0m`;
      console.log(
        `  ${pad(r.pattern, 30)} ${rpad(r.sieve.hit_rate_pct.toFixed(1) + '%', 9)}` +
        ` ${rpad(r.lru.hit_rate_pct.toFixed(1) + '%', 9)} ${rpad(r.fifo.hit_rate_pct.toFixed(1) + '%', 9)} ${tag}`,
      );
    }
    console.log('');

    allResults.cache = results;
  }

  // ─── 5. Multi-Agent Concurrency ───────────────────────────────────────
  if (shouldRun('agent')) {
    console.log('\x1b[1m━━━ Multi-Agent Concurrency ━━━\x1b[0m');
    console.log('\x1b[2m  N agents × 50 req/s each, overlapping capabilities, shared server\x1b[0m');
    console.log('');

    const counts = fast ? [1, 5, 10] : [1, 5, 10, 20];
    const results = await runMultiAgent(counts);

    const baseline = results[0];

    console.log(`  ${pad('Agents', 8)} ${rpad('Total', 8)} ${rpad('Agg RPS', 10)} ${rpad('P50', 10)} ${rpad('P95', 10)} ${rpad('P99', 10)} ${rpad('vs 1 agent', 10)}`);
    console.log('  ' + '─'.repeat(70));

    for (const r of results) {
      const p50Ratio = baseline ? (r.latency.latency.p50_ms / baseline.latency.latency.p50_ms) : 1;
      const tag = p50Ratio > 1.1 ? `\x1b[33m${p50Ratio.toFixed(2)}x\x1b[0m` : `\x1b[32m${p50Ratio.toFixed(2)}x\x1b[0m`;
      console.log(
        `  ${pad(String(r.agent_count), 8)} ${rpad(fmtNum(r.total_completed), 8)} ${rpad(fmtNum(r.aggregate_rps), 10)}` +
        ` ${rpad(fmtMs(r.latency.latency.p50_ms), 10)} ${rpad(fmtMs(r.latency.latency.p95_ms), 10)}` +
        ` ${rpad(fmtMs(r.latency.latency.p99_ms), 10)} ${rpad(tag, 10)}`,
      );
    }

    if (results.length >= 2) {
      const last = results[results.length - 1];
      const scaleFactor = last.aggregate_rps / (baseline?.aggregate_rps ?? 1);
      console.log('');
      console.log(`  \x1b[2mScaling efficiency: ${last.agent_count} agents → ${scaleFactor.toFixed(2)}x throughput (ideal: ${last.agent_count}x)\x1b[0m`);
    }
    console.log('');

    allResults.multiAgent = results;
  }

  // ─── Summary ──────────────────────────────────────────────────────────

  const totalTime = Math.round(performance.now() - startTime);
  console.log(`\x1b[2mCompleted in ${(totalTime / 1000).toFixed(1)}s\x1b[0m`);

  if (jsonOutput) {
    const outPath = `./benchmark-results/e2e-${Date.now()}.json`;
    const fs = await import('node:fs');
    fs.mkdirSync('./benchmark-results', { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(allResults, null, 2));
    console.log(`\nJSON written to ${outPath}`);
  }
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
