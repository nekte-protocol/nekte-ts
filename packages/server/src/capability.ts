/**
 * Capability Registration
 *
 * Register capabilities with typed schemas (via Zod)
 * that auto-generate version hashes and multi-level projections.
 */

import type { z } from 'zod';
import type {
  CapabilitySchema,
  ContextEnvelope,
  DetailLevel,
  MultiLevelResult,
  TokenBudget,
} from '@nekte/core';
import { computeVersionHash } from '@nekte/core';

// ---------------------------------------------------------------------------
// Handler types
// ---------------------------------------------------------------------------

export interface HandlerContext {
  budget: TokenBudget;
  context?: ContextEnvelope;
  taskId?: string;
  /** AbortSignal for cooperative cancellation (from task lifecycle) */
  signal: AbortSignal;
  /** Checkpoint data from a previously suspended task (for resume) */
  checkpoint?: Record<string, unknown>;
}

export type CapabilityHandler<TIn = unknown, TOut = unknown> = (
  input: TIn,
  ctx: HandlerContext,
) => Promise<TOut> | TOut;

export interface CapabilityConfig<TIn = unknown, TOut = unknown> {
  /** Zod schema for input validation */
  inputSchema: z.ZodType<TIn>;
  /** Zod schema for output validation */
  outputSchema: z.ZodType<TOut>;
  /** Category for discovery filtering */
  category: string;
  /** Human-readable description (used in L1 discovery) */
  description: string;
  /** Agent-facing use-case hint (used in L1 discovery). E.g. "Use when you need X. Typical input: Y." */
  agent_hint?: string;
  /** The handler function */
  handler: CapabilityHandler<TIn, TOut>;
  /** Generate minimal string representation of output */
  toMinimal?: (output: TOut) => string;
  /** Generate compact representation of output */
  toCompact?: (output: TOut) => Record<string, unknown>;
  /** Performance hints */
  cost?: {
    avg_ms?: number;
    avg_tokens?: number;
  };
  /** Example input/output pairs */
  examples?: Array<{ in: TIn; out: TOut }>;
}

// ---------------------------------------------------------------------------
// Registered capability
// ---------------------------------------------------------------------------

export interface RegisteredCapability {
  id: string;
  config: CapabilityConfig;
  schema: CapabilitySchema;
  versionHash: string;
}

export class CapabilityRegistry {
  private capabilities = new Map<string, RegisteredCapability>();

  /**
   * Register a new capability.
   */
  register<TIn, TOut>(id: string, config: CapabilityConfig<TIn, TOut>): RegisteredCapability {
    const inputJsonSchema = this.zodToJsonSchema(config.inputSchema);
    const outputJsonSchema = this.zodToJsonSchema(config.outputSchema);
    const versionHash = computeVersionHash(inputJsonSchema, outputJsonSchema);

    const schema: CapabilitySchema = {
      id,
      cat: config.category,
      h: versionHash,
      desc: config.description,
      ...(config.agent_hint !== undefined && { agent_hint: config.agent_hint }),
      cost: config.cost,
      input: inputJsonSchema,
      output: outputJsonSchema,
      examples: config.examples?.map((ex) => ({
        in: ex.in as Record<string, unknown>,
        out: ex.out as Record<string, unknown>,
      })),
    };

    const registered: RegisteredCapability = {
      id,
      config: config as CapabilityConfig,
      schema,
      versionHash,
    };

    this.capabilities.set(id, registered);
    return registered;
  }

  /**
   * Get a registered capability by ID.
   */
  get(id: string): RegisteredCapability | undefined {
    return this.capabilities.get(id);
  }

  /**
   * Get all registered capabilities.
   * Returns the Map's values iterator to avoid copying the full array on every call.
   */
  all(): RegisteredCapability[] {
    return [...this.capabilities.values()];
  }

  /** Iterate capabilities without allocating an array copy */
  values(): IterableIterator<RegisteredCapability> {
    return this.capabilities.values();
  }

  /** Number of registered capabilities */
  get size(): number {
    return this.capabilities.size;
  }

  /**
   * Filter capabilities by category or query.
   */
  filter(opts?: { category?: string; query?: string; id?: string }): RegisteredCapability[] {
    let caps = this.all();

    if (opts?.id) {
      const found = this.get(opts.id);
      return found ? [found] : [];
    }

    if (opts?.category) {
      caps = caps.filter((c) => c.schema.cat === opts.category);
    }

    if (opts?.query) {
      const q = opts.query.toLowerCase();
      caps = caps.filter(
        (c) => c.id.toLowerCase().includes(q) || c.schema.desc.toLowerCase().includes(q),
      );
    }

    return caps;
  }

  /**
   * Invoke a capability with input and budget context.
   */
  async invoke(id: string, input: unknown, ctx: HandlerContext): Promise<MultiLevelResult> {
    const cap = this.capabilities.get(id);
    if (!cap) throw new Error(`Capability not found: ${id}`);

    // Validate input
    const parsed = cap.config.inputSchema.parse(input);

    // Execute handler
    const startMs = performance.now();
    const rawResult = await cap.config.handler(parsed, ctx);
    const ms = Math.round(performance.now() - startMs);

    // Validate output against schema
    const result = cap.config.outputSchema.parse(rawResult);

    // Build multi-level result
    const full = (
      typeof result === 'object' && result !== null ? result : { value: result }
    ) as Record<string, unknown>;

    return {
      minimal: cap.config.toMinimal?.(result as never),
      compact: cap.config.toCompact?.(result as never) ?? full,
      full: { ...full, _meta: { ms } },
    };
  }

  /**
   * Convert a Zod schema to a plain JSON Schema-like object.
   * Simplified version — in production, use zod-to-json-schema.
   */
  private zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
    // Use Zod's built-in description if available
    const description = schema.description;

    if ('shape' in schema && typeof (schema as z.ZodObject<never>).shape === 'object') {
      const shape = (schema as z.ZodObject<never>).shape;
      const properties: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = this.zodToJsonSchema(value as z.ZodType);
      }
      return { type: 'object', properties, ...(description && { description }) };
    }

    // Fallback: return a generic schema marker
    return { type: 'unknown', ...(description && { description }) };
  }
}
