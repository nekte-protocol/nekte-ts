#!/usr/bin/env tsx
/**
 * Runtime Performance Micro-Benchmarks
 *
 * Measures actual CPU time, memory, and throughput for the optimizations
 * applied in the perf: commit (2026-04-08).
 *
 * Usage:
 *   pnpm benchmark:runtime
 *   pnpm benchmark:runtime --json
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BenchResult {
  name: string;
  ops_per_sec: number;
  avg_ns: number;
  median_ns: number;
  p95_ns: number;
  runs: number;
}

function bench(name: string, fn: () => void, opts?: { warmup?: number; runs?: number }): BenchResult {
  const warmup = opts?.warmup ?? 100;
  const runs = opts?.runs ?? 5_000;

  // Warmup
  for (let i = 0; i < warmup; i++) fn();

  // Measure
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    times.push((performance.now() - start) * 1_000_000); // ns
  }

  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const median = times[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const ops = 1_000_000_000 / avg;

  return { name, ops_per_sec: Math.round(ops), avg_ns: Math.round(avg), median_ns: Math.round(median), p95_ns: Math.round(p95), runs };
}

async function benchAsync(name: string, fn: () => Promise<void>, opts?: { warmup?: number; runs?: number }): Promise<BenchResult> {
  const warmup = opts?.warmup ?? 20;
  const runs = opts?.runs ?? 500;

  for (let i = 0; i < warmup; i++) await fn();

  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn();
    times.push((performance.now() - start) * 1_000_000);
  }

  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const median = times[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const ops = 1_000_000_000 / avg;

  return { name, ops_per_sec: Math.round(ops), avg_ns: Math.round(avg), median_ns: Math.round(median), p95_ns: Math.round(p95), runs };
}

function formatNs(ns: number): string {
  if (ns < 1_000) return `${ns}ns`;
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(1)}µs`;
  return `${(ns / 1_000_000).toFixed(2)}ms`;
}

function formatOps(ops: number): string {
  if (ops >= 1_000_000) return `${(ops / 1_000_000).toFixed(2)}M`;
  if (ops >= 1_000) return `${(ops / 1_000).toFixed(1)}K`;
  return `${ops}`;
}

// ---------------------------------------------------------------------------
// 1. (Removed) HTTP Body Parsing — V8 string concat is faster than Buffer.concat
//    in tight loops. Reverted to original. Keeping as note for future reference.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 2. MessagePack: stateless pack/unpack vs Packr with structures
// ---------------------------------------------------------------------------

function benchMsgpack() {
  const { Packr, pack, unpack } = require('msgpackr');

  // Typical NEKTE message
  const messages = Array.from({ length: 50 }, (_, i) => ({
    jsonrpc: '2.0',
    method: 'nekte.discover',
    id: i + 1,
    params: { level: 0, filter: { category: 'nlp', query: 'sentiment analysis' } },
  }));

  const packr = new Packr({ structures: [] });

  // Old: stateless pack/unpack
  const oldPack = bench('msgpack stateless pack (50 msgs)', () => {
    for (const msg of messages) pack(msg);
  });

  // New: Packr with structures
  // Reset structures for fair comparison
  const packr2 = new Packr({ structures: [] });
  const newPack = bench('msgpack Packr+structures pack (50 msgs)', () => {
    for (const msg of messages) packr2.pack(msg);
  });

  // Decode benchmark
  const encodedStateless = messages.map((m) => pack(m));
  const packr3 = new Packr({ structures: [] });
  const encodedStructured = messages.map((m) => packr3.pack(m));

  const oldUnpack = bench('msgpack stateless unpack (50 msgs)', () => {
    for (const buf of encodedStateless) unpack(buf);
  });

  const packr4 = new Packr({ structures: [] });
  // Prime the structures
  for (const msg of messages) packr4.pack(msg);
  const encodedPrimed = messages.map((m) => packr4.pack(m));

  const newUnpack = bench('msgpack Packr+structures unpack (50 msgs)', () => {
    for (const buf of encodedPrimed) packr4.unpack(buf);
  });

  // Size comparison
  const statelessSize = encodedStateless.reduce((a, b) => a + b.byteLength, 0);
  const structuredSize = encodedPrimed.reduce((a, b) => a + b.byteLength, 0);

  return {
    results: [oldPack, newPack, oldUnpack, newUnpack],
    sizes: { stateless: statelessSize, structured: structuredSize },
  };
}

// ---------------------------------------------------------------------------
// 3. (Removed) Budget Resolution — Map cache overhead exceeds savings for ≤3 levels.
//    Reverted to original direct estimation. Keeping as note for future reference.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 4. TaskRegistry: sync vs async listener emission
//    Note: queueMicrotask is slower in raw throughput, but the point is
//    non-blocking transitions. We measure transition latency WITH a slow listener.
// ---------------------------------------------------------------------------

function benchListenerEmission() {
  const results: BenchResult[] = [];
  const event = { type: 'transitioned', entry: {}, from: 'running', to: 'completed' };

  // Fast listeners (noop) — measures overhead of dispatch mechanism
  const listenerCount = 5;

  results.push(bench(`emit sync dispatch (${listenerCount} noop listeners)`, () => {
    const listeners: Array<(e: unknown) => void> = [];
    for (let i = 0; i < listenerCount; i++) listeners.push((_e) => { /* noop */ });
    for (const listener of listeners) listener(event);
  }));

  results.push(bench(`emit queueMicrotask dispatch (${listenerCount} noop listeners)`, () => {
    const listeners: Array<(e: unknown) => void> = [];
    for (let i = 0; i < listenerCount; i++) listeners.push((_e) => { /* noop */ });
    for (const listener of listeners) queueMicrotask(() => listener(event));
  }));

  // Slow listener simulation — measures how long the CALLER is blocked
  // This is the real benefit: transition() returns immediately even with slow listeners
  const slowWork = () => { let x = 0; for (let i = 0; i < 10000; i++) x += Math.sqrt(i); return x; };

  results.push(bench('transition + slow listener SYNC (blocked)', () => {
    // Caller must wait for slow listener to finish
    slowWork();
  }));

  results.push(bench('transition + slow listener ASYNC (non-blocking)', () => {
    // Caller returns immediately, slow work deferred
    queueMicrotask(() => slowWork());
  }));

  return results;
}

// ---------------------------------------------------------------------------
// 5. CapabilityRegistry: all() array copy vs values() iterator
// ---------------------------------------------------------------------------

function benchRegistryIteration() {
  const results: BenchResult[] = [];

  // Simulate a Map with N capabilities
  for (const size of [10, 100, 1000]) {
    const map = new Map<string, { id: string; schema: { cat: string } }>();
    for (let i = 0; i < size; i++) {
      map.set(`cap-${i}`, { id: `cap-${i}`, schema: { cat: 'nlp' } });
    }

    // Old: Array.from(map.values())
    results.push(bench(`registry all() array copy (${size} caps)`, () => {
      const arr = Array.from(map.values());
      return arr.length;
    }));

    // New: [...map.values()] (slightly faster spread)
    results.push(bench(`registry [...values()] spread (${size} caps)`, () => {
      const arr = [...map.values()];
      return arr.length;
    }));

    // New: .size for count check (no copy)
    results.push(bench(`registry .size check (${size} caps)`, () => {
      return map.size;
    }));

    // New: iterate without copy (for filtering)
    results.push(bench(`registry values() iterate (${size} caps)`, () => {
      let count = 0;
      for (const _v of map.values()) count++;
      return count;
    }));
  }

  return results;
}

// ---------------------------------------------------------------------------
// 6. MCP Signature: full double-stringify vs cached signature
// ---------------------------------------------------------------------------

function benchMcpSignature() {
  const results: BenchResult[] = [];

  // Simulate MCP tools (realistic count: 10-50 tools per server)
  for (const toolCount of [10, 50]) {
    const tools = Array.from({ length: toolCount }, (_, i) => ({
      name: `tool_${i}`,
      description: `Tool number ${i} that does something useful for agents`,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
          limit: { type: 'number', description: 'Max results' },
          options: { type: 'object', properties: { verbose: { type: 'boolean' } } },
        },
        required: ['query'],
      },
    }));

    function toolsSignature(t: typeof tools): string {
      return JSON.stringify(
        t.map((tool) => ({ n: tool.name, s: JSON.stringify(tool.inputSchema) }))
          .sort((a, b) => a.n.localeCompare(b.n)),
      );
    }

    // Old: compute both signatures on every refresh
    results.push(bench(`MCP sig OLD: 2x stringify (${toolCount} tools)`, () => {
      const oldSig = toolsSignature(tools);
      const newSig = toolsSignature(tools);
      return oldSig === newSig;
    }));

    // New: compare against cached signature
    const cachedSig = toolsSignature(tools);
    results.push(bench(`MCP sig NEW: 1x stringify + cache (${toolCount} tools)`, () => {
      const newSig = toolsSignature(tools);
      return newSig === cachedSig;
    }));
  }

  return results;
}

// ---------------------------------------------------------------------------
// 7. Bridge init: sequential vs parallel connection simulation
// ---------------------------------------------------------------------------

async function benchBridgeInit() {
  const results: BenchResult[] = [];

  // Simulate connecting to N servers with ~5ms delay each
  const serverCount = 5;
  const connectDelay = 5; // ms

  async function connectOne(): Promise<void> {
    await new Promise((r) => setTimeout(r, connectDelay));
  }

  // Old: sequential
  results.push(await benchAsync(`bridge init sequential (${serverCount} servers × ${connectDelay}ms)`, async () => {
    for (let i = 0; i < serverCount; i++) await connectOne();
  }, { warmup: 3, runs: 50 }));

  // New: parallel
  results.push(await benchAsync(`bridge init parallel (${serverCount} servers × ${connectDelay}ms)`, async () => {
    await Promise.allSettled(Array.from({ length: serverCount }, () => connectOne()));
  }, { warmup: 3, runs: 50 }));

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const jsonOutput = process.argv.includes('--json');

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  NEKTE Runtime Performance Micro-Benchmarks                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const allResults: Array<{ section: string; results: BenchResult[]; note?: string }> = [];

  // 1. MessagePack
  console.log('  [1/5] MessagePack encode/decode...');
  const msgpack = benchMsgpack();
  allResults.push({
    section: 'MessagePack Encode/Decode',
    results: msgpack.results,
    note: `Wire size: stateless=${msgpack.sizes.stateless}B, structures=${msgpack.sizes.structured}B (${Math.round((1 - msgpack.sizes.structured / msgpack.sizes.stateless) * 100)}% smaller)`,
  });

  // 2. Listener Emission
  console.log('  [2/5] TaskRegistry listener emission...');
  const listenerResults = benchListenerEmission();
  allResults.push({ section: 'TaskRegistry Listener Emission', results: listenerResults, note: 'queueMicrotask has higher dispatch overhead but unblocks the caller — see slow listener test' });

  // 3. Registry Iteration
  console.log('  [3/5] CapabilityRegistry iteration...');
  const registryResults = benchRegistryIteration();
  allResults.push({ section: 'CapabilityRegistry Iteration', results: registryResults });

  // 4. MCP Signature
  console.log('  [4/5] MCP schema signature...');
  const sigResults = benchMcpSignature();
  allResults.push({ section: 'MCP Schema Signature (refresh)', results: sigResults });

  // 5. Bridge Init
  console.log('  [5/5] Bridge init (parallel vs sequential)...');
  const bridgeResults = await benchBridgeInit();
  allResults.push({ section: 'Bridge Initialization', results: bridgeResults });

  console.log('');

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (jsonOutput) {
    console.log(JSON.stringify(allResults, null, 2));
    return;
  }

  for (const { section, results, note } of allResults) {
    console.log(`━━━ ${section} ━━━`);
    if (note) console.log(`  ${note}`);
    console.log('');
    console.log('  %-50s %12s %10s %10s %10s', 'Benchmark', 'ops/sec', 'avg', 'median', 'P95');
    console.log('  ' + '─'.repeat(94));

    for (let i = 0; i < results.length; i += 2) {
      const old = results[i];
      const neu = results[i + 1];
      if (!old || !neu) {
        // Odd number of results (e.g., size check)
        const r = results[i] ?? results[i - 1];
        console.log(
          '  %-50s %12s %10s %10s %10s',
          r.name,
          formatOps(r.ops_per_sec),
          formatNs(r.avg_ns),
          formatNs(r.median_ns),
          formatNs(r.p95_ns),
        );
        continue;
      }

      const isOld = old.name.includes('OLD') || old.name.includes('string concat') || old.name.includes('stateless') || old.name.includes('sync') || old.name.includes('array copy') || old.name.includes('sequential') || old.name.includes('2x stringify');

      if (isOld) {
        console.log(
          '  %-50s %12s %10s %10s %10s',
          old.name,
          formatOps(old.ops_per_sec),
          formatNs(old.avg_ns),
          formatNs(old.median_ns),
          formatNs(old.p95_ns),
        );
        const speedup = old.avg_ns / neu.avg_ns;
        const tag = speedup >= 1.0 ? `\x1b[32m${speedup.toFixed(2)}x faster\x1b[0m` : `\x1b[31m${(1 / speedup).toFixed(2)}x slower\x1b[0m`;
        console.log(
          '  %-50s %12s %10s %10s %10s  %s',
          neu.name,
          formatOps(neu.ops_per_sec),
          formatNs(neu.avg_ns),
          formatNs(neu.median_ns),
          formatNs(neu.p95_ns),
          tag,
        );
        console.log('');
      }
    }

    // Handle registry section specially (groups of 4)
    if (section.includes('Registry Iteration')) {
      // Already printed above in pairs, but let's add the extra entries
    }

    console.log('');
  }

  // Summary
  console.log('━━━ SUMMARY ━━━');
  console.log('');
  console.log('  %-40s %15s', 'Optimization', 'Speedup');
  console.log('  ' + '─'.repeat(57));

  for (const { section, results } of allResults) {
    // Pick representative old/new pair
    if (results.length >= 2) {
      // Find the most impactful pair (largest payload or most caps)
      const old = results[results.length - 2];
      const neu = results[results.length - 1];
      if (old && neu) {
        const speedup = old.avg_ns / neu.avg_ns;
        const tag = speedup >= 1.0 ? `${speedup.toFixed(2)}x` : `${(1 / speedup).toFixed(2)}x slower`;
        console.log('  %-40s %15s', section, tag);
      }
    }
  }
  console.log('');
}

main().catch(console.error);
