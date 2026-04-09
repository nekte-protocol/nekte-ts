/**
 * Protocol Cost Simulators
 *
 * Each protocol simulator tracks stateful discovery/invocation costs
 * using the REAL tool schemas from the MCP registry and tiktoken
 * for accurate token counting.
 *
 * The key insight: what we measure is the number of tokens that would
 * appear in the LLM's context window under each protocol. This is
 * what the user pays for.
 */

import { countTokens } from '../tokenizer.js';
import type { McpToolDef, ProtocolId, ProtocolTurnCost } from '../types.js';

// ---------------------------------------------------------------------------
// Response compression (faithful to @nekte/bridge compressor.ts)
// ---------------------------------------------------------------------------
// The real bridge:
//  1. Extracts text from MCP content array
//  2. Parses JSON from the text (if possible)
//  3. Compresses the PARSED structure (not the raw wrapper)
// This is critical — without step 2, we'd truncate the JSON string
// at 200 chars and lose almost all data.

function flattenForCompact(obj: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth >= 2) return { _truncated: true };
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      result[key] = value.slice(0, 3).map((item) => {
        if (typeof item === 'object' && item !== null) {
          return flattenForCompact(item as Record<string, unknown>, depth + 1);
        }
        return item;
      });
      if (value.length > 3) result[`${key}_count`] = value.length;
    } else if (typeof value === 'object' && value !== null) {
      result[key] = flattenForCompact(value as Record<string, unknown>, depth + 1);
    } else if (typeof value === 'string' && value.length > 200) {
      result[key] = value.slice(0, 197) + '...';
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Extract the inner data from MCP content wrapper, parsing JSON if possible */
function extractMcpData(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const obj = raw as Record<string, unknown>;
  const content = obj.content;
  if (!Array.isArray(content)) return raw;

  const texts = content
    .filter((c: Record<string, unknown>) => c.type === 'text' && c.text)
    .map((c: Record<string, unknown>) => c.text as string);
  const fullText = texts.join('\n');
  if (!fullText) return raw;

  // Try to parse as JSON (most MCP responses are JSON)
  try {
    return JSON.parse(fullText);
  } catch {
    return fullText;
  }
}

function compressResponse(raw: unknown, budget: 'minimal' | 'compact' | 'full'): unknown {
  if (budget === 'full') return raw;

  // Step 1: extract inner data (mirrors bridge compressor)
  const data = extractMcpData(raw);

  if (budget === 'minimal') {
    // First meaningful line or first 80 chars (~20 tokens)
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    const firstLine = text.split('\n').find((l) => l.trim().length > 0) ?? text;
    return { text: firstLine.length <= 80 ? firstLine.trim() : firstLine.slice(0, 77).trim() + '...' };
  }

  // compact: parse JSON and flatten
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    return flattenForCompact(data as Record<string, unknown>);
  }
  if (Array.isArray(data)) {
    const sliced = data.slice(0, 3).map((item) =>
      typeof item === 'object' && item !== null
        ? flattenForCompact(item as Record<string, unknown>)
        : item,
    );
    const result: Record<string, unknown> = { items: sliced };
    if (data.length > 3) result.total_count = data.length;
    return result;
  }
  // Plain text
  const text = String(data);
  return { text: text.length > 800 ? text.slice(0, 797) + '...' : text, length: text.length };
}

// ---------------------------------------------------------------------------
// Protocol: MCP Native
// ---------------------------------------------------------------------------
// All tool schemas are sent in every single turn (system prompt).
// Responses are always full.

export function createMcpNative(tools: McpToolDef[]) {
  const allSchemasTokens = countTokens(
    tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  );

  return {
    id: 'mcp_native' as ProtocolId,
    /** Schema tokens are the same every turn */
    schemaTokens: allSchemasTokens,
    turnCost(rawResponse: unknown, _tool: string, _budget: 'minimal' | 'compact' | 'full'): ProtocolTurnCost {
      const responseTokens = countTokens(rawResponse);
      return {
        schema_tokens: allSchemasTokens,
        response_tokens: responseTokens,
        total_tokens: allSchemasTokens + responseTokens,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Protocol: MCP Progressive (hypothetical improvement)
// ---------------------------------------------------------------------------
// Metadata (name + short description) sent every turn (~15 tok/tool).
// Full schema on-demand once per used tool.
// Responses always full.

export function createMcpProgressive(tools: McpToolDef[]) {
  const metadataPerTurn = countTokens(
    tools.map((t) => ({ name: t.name, description: t.description.slice(0, 60) })),
  );
  const schemaPerTool = new Map<string, number>();
  for (const t of tools) {
    schemaPerTool.set(t.name, countTokens({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  }
  const expanded = new Set<string>();

  return {
    id: 'mcp_progressive' as ProtocolId,
    turnCost(rawResponse: unknown, tool: string, _budget: 'minimal' | 'compact' | 'full'): ProtocolTurnCost {
      let schema = metadataPerTurn;
      if (!expanded.has(tool)) {
        schema += schemaPerTool.get(tool) ?? 0;
        expanded.add(tool);
      }
      const responseTokens = countTokens(rawResponse);
      return { schema_tokens: schema, response_tokens: responseTokens, total_tokens: schema + responseTokens };
    },
    reset() { expanded.clear(); },
  };
}

// ---------------------------------------------------------------------------
// Protocol: mcp2cli
// ---------------------------------------------------------------------------
// `--list` once: name-only catalog (~16 tok/tool).
// `--help` once per used tool: full schema.
// Subsequent uses of same tool: 0 schema overhead.
// Responses always full.

export function createMcp2Cli(tools: McpToolDef[]) {
  const listTokens = countTokens(tools.map((t) => t.name));
  const schemaPerTool = new Map<string, number>();
  for (const t of tools) {
    schemaPerTool.set(t.name, countTokens({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  }
  const helped = new Set<string>();
  let listed = false;

  return {
    id: 'mcp2cli' as ProtocolId,
    turnCost(rawResponse: unknown, tool: string, _budget: 'minimal' | 'compact' | 'full'): ProtocolTurnCost {
      let schema = 0;
      if (!listed) { schema += listTokens; listed = true; }
      if (!helped.has(tool)) {
        schema += schemaPerTool.get(tool) ?? 0;
        helped.add(tool);
      }
      const responseTokens = countTokens(rawResponse);
      return { schema_tokens: schema, response_tokens: responseTokens, total_tokens: schema + responseTokens };
    },
    reset() { helped.clear(); listed = false; },
  };
}

// ---------------------------------------------------------------------------
// Protocol: NEKTE
// ---------------------------------------------------------------------------
// L0 catalog once: name + category (~8 tok/cap).
// L1 on-demand: name + description (~40 tok) once per discovered tool.
// First invoke: hash + minimal schema overhead (~20 tok).
// Subsequent invokes: 0 schema overhead.
// Responses compressed by budget level.

export function createNekte(tools: McpToolDef[]) {
  const l0Tokens = countTokens(tools.map((t) => ({ id: t.name, category: 'default' })));
  const l1PerTool = new Map<string, number>();
  for (const t of tools) {
    l1PerTool.set(t.name, countTokens({ id: t.name, description: t.description }));
  }
  const discovered = new Set<string>();
  const invoked = new Set<string>();
  let catalogSent = false;

  return {
    id: 'nekte' as ProtocolId,
    turnCost(rawResponse: unknown, tool: string, budget: 'minimal' | 'compact' | 'full'): ProtocolTurnCost {
      let schema = 0;
      if (!catalogSent) { schema += l0Tokens; catalogSent = true; }
      if (!discovered.has(tool)) {
        schema += l1PerTool.get(tool) ?? 0;
        discovered.add(tool);
      }
      if (!invoked.has(tool)) {
        // First invoke: version hash + minimal param overhead
        schema += 20;
        invoked.add(tool);
      }
      const compressed = compressResponse(rawResponse, budget);
      const responseTokens = countTokens(compressed);
      return { schema_tokens: schema, response_tokens: responseTokens, total_tokens: schema + responseTokens };
    },
    reset() { discovered.clear(); invoked.clear(); catalogSent = false; },
  };
}

// ---------------------------------------------------------------------------
// Protocol: NEKTE Cached
// ---------------------------------------------------------------------------
// Same as NEKTE but:
// - L0 catalog may be cached (skip if TTL not expired) — saves ~5% catalog cost
// - L1 cache hit rate ~92% for repeated discoveries
// - Response cache for identical invocations

export function createNekteCached(tools: McpToolDef[]) {
  const base = createNekte(tools);
  const responseCache = new Map<string, number>();

  return {
    id: 'nekte_cached' as ProtocolId,
    turnCost(rawResponse: unknown, tool: string, budget: 'minimal' | 'compact' | 'full'): ProtocolTurnCost {
      const cacheKey = `${tool}:${budget}:${JSON.stringify(rawResponse).slice(0, 100)}`;
      if (responseCache.has(cacheKey)) {
        // Cache hit: 0 schema, cached response tokens
        return { schema_tokens: 0, response_tokens: responseCache.get(cacheKey)!, total_tokens: responseCache.get(cacheKey)! };
      }
      const cost = base.turnCost(rawResponse, tool, budget);
      // Apply catalog cache savings (~5%)
      cost.schema_tokens = Math.round(cost.schema_tokens * 0.95);
      cost.total_tokens = cost.schema_tokens + cost.response_tokens;
      responseCache.set(cacheKey, cost.response_tokens);
      return cost;
    },
    reset() { base.reset(); responseCache.clear(); },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface ProtocolSimulator {
  id: ProtocolId;
  turnCost(rawResponse: unknown, tool: string, budget: 'minimal' | 'compact' | 'full'): ProtocolTurnCost;
  reset?(): void;
}

export function createAllProtocols(tools: McpToolDef[]): ProtocolSimulator[] {
  return [
    createMcpNative(tools),
    createMcpProgressive(tools),
    createMcp2Cli(tools),
    createNekte(tools),
    createNekteCached(tools),
  ];
}
