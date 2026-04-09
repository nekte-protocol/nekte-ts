/**
 * Deterministic Schema Generator
 *
 * Generates reproducible tool schemas at various complexity levels.
 * Uses a seeded PRNG for determinism.
 */

import type { SchemaComplexity } from './scenario.js';

/** Seeded PRNG (mulberry32) — deterministic, portable */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const PROP_NAMES = [
  'text', 'query', 'input', 'content', 'message', 'data', 'value', 'name',
  'description', 'title', 'url', 'path', 'id', 'type', 'format', 'lang',
  'limit', 'offset', 'count', 'page', 'sort', 'order', 'filter', 'status',
  'priority', 'tags', 'category', 'author', 'date', 'version',
];

const TOOL_PREFIXES = [
  'get', 'create', 'update', 'delete', 'list', 'search', 'analyze',
  'generate', 'validate', 'transform', 'export', 'import', 'sync', 'check',
];

const TOOL_DOMAINS = [
  'user', 'file', 'document', 'report', 'task', 'event', 'metric',
  'alert', 'config', 'log', 'session', 'token', 'webhook', 'pipeline',
];

export interface GeneratedSchema {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string; enum?: string[]; default?: unknown }>;
    required: string[];
  };
}

/**
 * Generate deterministic tool schemas.
 */
export function generateSchemas(
  count: number,
  complexity: SchemaComplexity,
  seed = 42,
): GeneratedSchema[] {
  const rng = mulberry32(seed);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
  const range = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

  const propCounts: Record<SchemaComplexity, [number, number]> = {
    simple: [2, 3],
    medium: [5, 8],
    complex: [10, 15],
  };

  const schemas: GeneratedSchema[] = [];

  for (let i = 0; i < count; i++) {
    const prefix = pick(TOOL_PREFIXES);
    const domain = pick(TOOL_DOMAINS);
    const name = `${prefix}-${domain}-${i}`;
    const [minProps, maxProps] = propCounts[complexity];
    const numProps = range(minProps, maxProps);

    const properties: Record<string, { type: string; description?: string; enum?: string[]; default?: unknown }> = {};
    const required: string[] = [];
    const usedNames = new Set<string>();

    for (let j = 0; j < numProps; j++) {
      let propName = pick(PROP_NAMES);
      while (usedNames.has(propName)) propName = pick(PROP_NAMES);
      usedNames.add(propName);

      const types = ['string', 'number', 'boolean'];
      if (complexity === 'complex') types.push('string', 'number'); // weight toward string/number
      const propType = pick(types);

      const prop: { type: string; description?: string; enum?: string[]; default?: unknown } = { type: propType };

      if (complexity !== 'simple') {
        prop.description = `The ${propName} for ${domain} ${prefix} operation`;
      }

      if (complexity === 'complex' && propType === 'string' && rng() > 0.6) {
        prop.enum = ['low', 'medium', 'high'];
      }

      properties[propName] = prop;

      if (j < Math.ceil(numProps / 2)) {
        required.push(propName);
      }
    }

    schemas.push({
      name,
      description: `${prefix} ${domain} — ${complexity} complexity tool (${numProps} params)`,
      inputSchema: { type: 'object', properties, required },
    });
  }

  return schemas;
}

/**
 * Estimate tokens for a schema (MCP format).
 */
export function estimateSchemaTokens(schema: GeneratedSchema): number {
  const json = JSON.stringify({
    name: schema.name,
    description: schema.description,
    inputSchema: schema.inputSchema,
  });
  return Math.ceil(json.length / 4);
}
