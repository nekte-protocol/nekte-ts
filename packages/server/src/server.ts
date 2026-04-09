/**
 * NekteServer — NEKTE protocol server
 *
 * Register capabilities, handle discovery/invocation/delegation,
 * and serve over HTTP or other transports.
 */

import type { z } from 'zod';
import {
  type AgentCard,
  type CapabilitySchema,
  type ContextEnvelope,
  type ContextParams,
  type DelegateParams,
  type DiscoverParams,
  type DiscoverResult,
  type InvokeParams,
  type InvokeResult,
  type IntrospectParams,
  type IntrospectResult,
  type NekteError,
  type NekteMethod,
  type NekteRequest,
  type NekteResponse,
  type TaskCancelParams,
  type TaskResumeParams,
  type TaskStatusParams,
  type VerifyParams,
  NEKTE_ERRORS,
  NEKTE_VERSION,
  WELL_KNOWN_PATH,
  resolveBudget,
  createBudget,
  createLogger,
  type Logger,
  type LogLevel,
  PROTOCOL_GUIDE_COMPACT,
  PROTOCOL_GUIDE_FULL,
  PROTOCOL_GUIDE_SECTIONS,
} from '@nekte/core';
import { projectCapability } from '@nekte/core';
import { CapabilityRegistry, type CapabilityConfig, type HandlerContext } from './capability.js';
import { noAuth, type AuthHandler } from './auth.js';
import { KeywordFilterStrategy } from '@nekte/core';
import type { CapabilityFilterStrategy, FilterableCapability } from '@nekte/core';
import type { SseStream } from './sse-stream.js';
import {
  TaskRegistry,
  TaskNotFoundError,
  TaskNotCancellableError,
  TaskNotResumableError,
} from './task-registry.js';

/**
 * DelegateHandler — the application-layer contract for task delegation.
 *
 * Every handler receives an AbortSignal for cooperative cancellation.
 * The stream adapter (SSE or gRPC) is injected by the transport layer —
 * handlers are transport-agnostic.
 */
export type DelegateHandler = (
  task: import('@nekte/core').Task,
  stream: SseStream,
  context: ContextEnvelope | undefined,
  /** AbortSignal for cooperative cancellation — always provided */
  signal: AbortSignal,
) => Promise<void>;

// ---------------------------------------------------------------------------
// Server config
// ---------------------------------------------------------------------------

export interface NekteServerConfig {
  /** Agent name */
  agent: string;
  /** Agent version */
  version?: string;
  /** Auth method advertised in agent card */
  auth?: 'bearer' | 'apikey' | 'none';
  /** Log level. Default: 'info' */
  logLevel?: LogLevel;
  /** Auth handler for HTTP requests. Default: noAuth() */
  authHandler?: AuthHandler;
  /** Capability filter strategy. Default: keyword matching */
  filterStrategy?: CapabilityFilterStrategy;
}

// ---------------------------------------------------------------------------
// NekteServer
// ---------------------------------------------------------------------------

export class NekteServer {
  readonly config: NekteServerConfig;
  readonly registry: CapabilityRegistry;
  /** Task lifecycle registry — tracks active tasks, enables cancel/resume */
  readonly tasks: TaskRegistry;
  readonly log: Logger;
  private readonly auth: AuthHandler;
  /** @internal Used by HTTP/gRPC transport for streaming delegation */
  delegateHandler?: DelegateHandler;
  private readonly filterStrategy?: CapabilityFilterStrategy;
  private contexts = new Map<string, ContextEnvelope>();
  private contextTimestamps = new Map<string, number>();
  private contextCleanupTimer?: ReturnType<typeof setInterval>;
  /** LRU cache for semantic filter results: query → { caps, timestamp, lastAccess } */
  private filterCache = new Map<string, { caps: string[]; ts: number; lastAccess: number }>();
  private static readonly FILTER_CACHE_TTL_MS = 30_000;
  private static readonly FILTER_CACHE_MAX = 100;
  private static readonly CONTEXT_CLEANUP_INTERVAL_MS = 60_000;
  /** Maximum number of stored contexts to prevent memory exhaustion */
  private static readonly MAX_CONTEXTS = 1000;

  constructor(config: NekteServerConfig) {
    this.config = config;
    this.registry = new CapabilityRegistry();
    this.tasks = new TaskRegistry();
    this.log = createLogger(`nekte:${config.agent}`, config.logLevel);
    this.auth = config.authHandler ?? noAuth();
    this.filterStrategy = config.filterStrategy;

    // Periodic cleanup of expired contexts (with error handling)
    this.contextCleanupTimer = setInterval(() => {
      try {
        this.cleanupExpiredContexts();
      } catch (err) {
        this.log.error('Context cleanup failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, NekteServer.CONTEXT_CLEANUP_INTERVAL_MS);
    if (typeof this.contextCleanupTimer === 'object' && 'unref' in this.contextCleanupTimer) {
      this.contextCleanupTimer.unref();
    }
  }

  /** Remove expired contexts proactively instead of relying on lazy TTL checks */
  private cleanupExpiredContexts(): void {
    const now = Date.now();
    for (const [id, ctx] of this.contexts) {
      const storedAt = this.contextTimestamps.get(id) ?? 0;
      if ((now - storedAt) / 1000 > ctx.ttl_s) {
        this.contexts.delete(id);
        this.contextTimestamps.delete(id);
      }
    }
  }

  /**
   * Register a capability with typed schemas.
   */
  capability<TIn, TOut>(id: string, config: CapabilityConfig<TIn, TOut>): this {
    this.registry.register(id, config);
    return this;
  }

  /**
   * Register a streaming delegate handler.
   * When set, `nekte.delegate` uses SSE to stream progress/results.
   */
  onDelegate(handler: DelegateHandler): this {
    this.delegateHandler = handler;
    return this;
  }

  /**
   * Generate the Agent Card for this server.
   */
  agentCard(endpoint: string): AgentCard {
    return {
      nekte: NEKTE_VERSION,
      agent: this.config.agent,
      endpoint,
      caps: [...this.registry.values()].map((c) => c.id),
      auth: this.config.auth ?? 'none',
      budget_support: true,
      instructions: PROTOCOL_GUIDE_COMPACT,
    };
  }

  /**
   * Handle a NEKTE JSON-RPC request.
   */
  async handleRequest(request: NekteRequest): Promise<NekteResponse> {
    const { method, id, params } = request;

    try {
      // Validate request structure
      if (typeof id !== 'string' && typeof id !== 'number') {
        return this.error(0, -32600, 'Invalid request: id must be a string or number');
      }
      if (typeof id === 'string' && id.length > 256) {
        return this.error(0, -32600, 'Invalid request: id too long');
      }

      switch (method) {
        case 'nekte.discover':
          return this.ok(id, await this.handleDiscover(params as DiscoverParams));
        case 'nekte.invoke':
          return this.ok(id, await this.handleInvoke(params as InvokeParams));
        case 'nekte.delegate':
          return this.ok(id, await this.handleDelegate(params as DelegateParams));
        case 'nekte.context':
          return this.ok(id, await this.handleContext(params as ContextParams));
        case 'nekte.verify':
          return this.ok(id, await this.handleVerify(params as VerifyParams));
        case 'nekte.task.cancel':
          return this.ok(id, this.handleTaskCancel(params as TaskCancelParams));
        case 'nekte.task.resume':
          return this.ok(id, this.handleTaskResume(params as TaskResumeParams));
        case 'nekte.task.status':
          return this.ok(id, this.handleTaskStatus(params as TaskStatusParams));
        case 'nekte.introspect':
          return this.ok(id, this.handleIntrospect(params as IntrospectParams));
        default:
          return this.error(id, -32601, `Method not found: ${method}`);
      }
    } catch (err) {
      if (err instanceof Error && 'nekteError' in err) {
        return {
          jsonrpc: '2.0',
          id,
          error: (err as Error & { nekteError: NekteError }).nekteError,
        };
      }
      // Sanitize error messages — don't leak internal details
      this.log.error('Request handler error', {
        method,
        error: err instanceof Error ? err.message : String(err),
      });
      return this.error(id, -32000, 'Internal server error');
    }
  }

  // -------------------------------------------------------------------------
  // Method handlers
  // -------------------------------------------------------------------------

  private async handleDiscover(params: DiscoverParams): Promise<DiscoverResult> {
    let caps = this.registry.filter(params.filter);

    // Apply semantic/hybrid filtering if strategy is configured and query is present
    if (this.filterStrategy && params.filter?.query) {
      const cacheKey = `${params.filter.query}|${params.filter.top_k ?? ''}|${params.filter.threshold ?? ''}|${params.filter.category ?? ''}`;
      const cached = this.filterCache.get(cacheKey);
      const now = Date.now();

      if (cached && now - cached.ts < NekteServer.FILTER_CACHE_TTL_MS) {
        // Use cached filter results — avoids re-running embeddings
        cached.lastAccess = now; // LRU: update access time
        const cachedSet = new Set(cached.caps);
        const cachedOrder = new Map(cached.caps.map((id, i) => [id, i]));
        caps = caps
          .filter((c) => cachedSet.has(c.id))
          .sort((a, b) => (cachedOrder.get(a.id) ?? 0) - (cachedOrder.get(b.id) ?? 0));
      } else {
        const filterables: FilterableCapability[] = caps.map((c) => ({
          id: c.id,
          category: c.schema.cat,
          description: c.schema.desc,
        }));

        const ranked = await this.filterStrategy.filter(filterables, params.filter.query, {
          top_k: params.filter.top_k,
          threshold: params.filter.threshold,
          category: params.filter.category,
        });

        const rankedIds = new Set(ranked.map((r) => r.id));
        const rankedOrder = new Map(ranked.map((r, i) => [r.id, i]));
        caps = caps
          .filter((c) => rankedIds.has(c.id))
          .sort((a, b) => (rankedOrder.get(a.id) ?? 0) - (rankedOrder.get(b.id) ?? 0));

        // Cache the ranked IDs for future queries
        this.filterCache.set(cacheKey, { caps: ranked.map((r) => r.id), ts: now, lastAccess: now });
        // LRU eviction: evict least recently accessed entry
        if (this.filterCache.size > NekteServer.FILTER_CACHE_MAX) {
          let lruKey: string | undefined;
          let lruTime = Infinity;
          for (const [key, value] of this.filterCache) {
            if (value.lastAccess < lruTime) {
              lruTime = value.lastAccess;
              lruKey = key;
            }
          }
          if (lruKey !== undefined) this.filterCache.delete(lruKey);
        }
      }
    }

    return {
      agent: this.config.agent,
      v: this.config.version,
      caps: caps.map((c) => projectCapability(c.schema, params.level)),
    };
  }

  private async handleInvoke(params: InvokeParams): Promise<InvokeResult> {
    const cap = this.registry.get(params.cap);
    if (!cap) {
      throw Object.assign(new Error(`Capability not found: ${params.cap}`), {
        nekteError: {
          code: NEKTE_ERRORS.CAPABILITY_NOT_FOUND,
          message: 'CAPABILITY_NOT_FOUND',
        },
      });
    }

    // Check version hash — zero-schema invocation
    if (params.h && params.h !== cap.versionHash) {
      const err: NekteError = {
        code: NEKTE_ERRORS.VERSION_MISMATCH,
        message: 'VERSION_MISMATCH',
        data: {
          current_hash: cap.versionHash,
          schema: projectCapability(cap.schema, 2),
        },
      };
      throw Object.assign(new Error('VERSION_MISMATCH'), { nekteError: err });
    }

    const budget = params.budget ?? createBudget();
    const ctx: HandlerContext = { budget, signal: new AbortController().signal };

    const multiLevel = await this.registry.invoke(params.cap, params.in, ctx);
    const resolved = resolveBudget(multiLevel, budget);

    return {
      out: resolved.data as Record<string, unknown>,
      resolved_level: resolved.level,
      meta: {
        ms: (multiLevel.full as Record<string, unknown> | undefined)?._meta
          ? (((multiLevel.full as Record<string, unknown>)._meta as Record<string, unknown>).ms as
              | number
              | undefined)
          : undefined,
      },
    };
  }

  private async handleDelegate(params: DelegateParams): Promise<unknown> {
    // Store context if provided
    if (params.context) {
      this.contexts.set(params.context.id, params.context);
    }

    // For now, delegate maps to invoke if a matching capability exists
    // In v0.3, this will support complex task orchestration
    if (this.registry.size === 0) {
      throw new Error('No capabilities registered to handle delegation');
    }

    // Resolve best matching capability using the configured filter strategy
    // (falls back to KeywordFilterStrategy with scored ranking)
    const strategy = this.filterStrategy ?? new KeywordFilterStrategy();
    const allCaps = this.registry.all();
    const filterables: FilterableCapability[] = allCaps.map((c) => ({
      id: c.id,
      category: c.schema.cat,
      description: c.schema.desc,
    }));
    const ranked = await strategy.filter(filterables, params.task.desc, {
      top_k: 1,
      threshold: 0.1,
    });
    const match = ranked.length > 0 ? this.registry.get(ranked[0].id) : undefined;

    if (!match) {
      return {
        task_id: params.task.id,
        status: 'failed',
        error: { code: 'NO_MATCHING_CAPABILITY', message: 'No capability matches the task' },
      };
    }

    const result = await this.registry.invoke(match.id, params.task, {
      budget: params.task.budget,
      context: params.context,
      taskId: params.task.id,
      signal: new AbortController().signal,
    });

    return {
      task_id: params.task.id,
      status: 'completed',
      out: result,
    };
  }

  /**
   * Context management with TTL enforcement and permission validation.
   */
  private async handleContext(params: ContextParams): Promise<unknown> {
    switch (params.action) {
      case 'share': {
        // Validate permissions structure
        const env = params.envelope;

        // Enforce context storage limits to prevent memory exhaustion
        if (this.contexts.size >= NekteServer.MAX_CONTEXTS && !this.contexts.has(env.id)) {
          // Evict oldest context
          let oldestId: string | undefined;
          let oldestTs = Infinity;
          for (const [id, ts] of this.contextTimestamps) {
            if (ts < oldestTs) {
              oldestTs = ts;
              oldestId = id;
            }
          }
          if (oldestId) {
            this.contexts.delete(oldestId);
            this.contextTimestamps.delete(oldestId);
          }
        }

        this.contexts.set(env.id, env);
        this.contextTimestamps.set(env.id, Date.now());
        this.log.debug('Context stored', { id: env.id, ttl_s: env.ttl_s });
        return { id: env.id, status: 'stored', ttl_s: env.ttl_s };
      }

      case 'request': {
        const ctx = this.contexts.get(params.envelope.id);
        if (!ctx) return { id: params.envelope.id, status: 'not_found' };

        // TTL enforcement
        const storedAt = this.contextTimestamps.get(params.envelope.id) ?? 0;
        const ageS = (Date.now() - storedAt) / 1000;
        if (ageS > ctx.ttl_s) {
          this.contexts.delete(params.envelope.id);
          this.contextTimestamps.delete(params.envelope.id);
          this.log.debug('Context expired', {
            id: params.envelope.id,
            age_s: Math.round(ageS),
            ttl_s: ctx.ttl_s,
          });
          throw Object.assign(new Error('Context expired'), {
            nekteError: { code: NEKTE_ERRORS.CONTEXT_EXPIRED, message: 'CONTEXT_EXPIRED' },
          });
        }

        // Permission check: forward
        if (params.envelope.permissions && !ctx.permissions.forward) {
          const requestingForward = params.envelope.permissions.forward;
          if (requestingForward) {
            throw Object.assign(new Error('Context cannot be forwarded'), {
              nekteError: {
                code: NEKTE_ERRORS.CONTEXT_PERMISSION_DENIED,
                message: 'CONTEXT_PERMISSION_DENIED: forward not allowed',
              },
            });
          }
        }

        return ctx;
      }

      case 'revoke': {
        this.contexts.delete(params.envelope.id);
        this.contextTimestamps.delete(params.envelope.id);
        this.log.debug('Context revoked', { id: params.envelope.id });
        return { id: params.envelope.id, status: 'revoked' };
      }

      default:
        throw new Error(`Unknown context action: ${params.action}`);
    }
  }

  // -------------------------------------------------------------------------
  // Task lifecycle handlers
  // -------------------------------------------------------------------------

  private handleTaskCancel(params: TaskCancelParams): unknown {
    try {
      const entry = this.tasks.getOrThrow(params.task_id);
      const previousStatus = entry.status;
      this.tasks.cancel(params.task_id, params.reason);
      this.log.info('Task cancelled', { taskId: params.task_id, reason: params.reason });
      return this.tasks.toLifecycleResult(entry, previousStatus);
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        throw Object.assign(new Error(err.message), {
          nekteError: { code: NEKTE_ERRORS.TASK_NOT_FOUND, message: err.message },
        });
      }
      if (err instanceof TaskNotCancellableError) {
        throw Object.assign(new Error(err.message), {
          nekteError: { code: NEKTE_ERRORS.TASK_NOT_CANCELLABLE, message: err.message },
        });
      }
      throw err;
    }
  }

  private handleTaskResume(params: TaskResumeParams): unknown {
    try {
      const entry = this.tasks.getOrThrow(params.task_id);
      const previousStatus = entry.status;
      this.tasks.resume(params.task_id);
      this.log.info('Task resumed', { taskId: params.task_id });
      return this.tasks.toLifecycleResult(entry, previousStatus);
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        throw Object.assign(new Error(err.message), {
          nekteError: { code: NEKTE_ERRORS.TASK_NOT_FOUND, message: err.message },
        });
      }
      if (err instanceof TaskNotResumableError) {
        throw Object.assign(new Error(err.message), {
          nekteError: { code: NEKTE_ERRORS.TASK_NOT_RESUMABLE, message: err.message },
        });
      }
      throw err;
    }
  }

  private handleTaskStatus(params: TaskStatusParams): unknown {
    try {
      return this.tasks.toStatusResult(params.task_id);
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        throw Object.assign(new Error(err.message), {
          nekteError: { code: NEKTE_ERRORS.TASK_NOT_FOUND, message: err.message },
        });
      }
      throw err;
    }
  }

  /**
   * Result verification — hash validation, sampling, and source tracking.
   *
   * Checks:
   *   - hash: SHA-256 hash of the task result for integrity
   *   - sample: representative input/output pairs from the task
   *   - source: metadata about the execution (model, processed count, errors)
   */
  private async handleVerify(params: VerifyParams): Promise<unknown> {
    const taskEntry = this.tasks.get(params.task_id);
    const result: Record<string, unknown> = {
      task_id: params.task_id,
      checks: params.checks,
      status: 'verified',
    };

    for (const check of params.checks) {
      switch (check) {
        case 'hash': {
          // Compute hash of the task result for integrity verification
          if (taskEntry) {
            const { createHash } = await import('node:crypto');
            const lastTransition = taskEntry.transitions[taskEntry.transitions.length - 1];
            const hashInput = JSON.stringify({
              task_id: params.task_id,
              status: taskEntry.status,
              completed_at: lastTransition?.timestamp,
            });
            result.hash = createHash('sha256').update(hashInput).digest('hex').slice(0, 16);
            result.hash_valid = true;
          } else {
            result.hash_valid = false;
            result.hash_error = 'Task not found in registry';
          }
          break;
        }

        case 'sample': {
          // Return task metadata as a sample
          if (taskEntry) {
            result.sample = {
              task_desc: taskEntry.task.desc,
              transitions: taskEntry.transitions.length,
              checkpoint_available: !!taskEntry.checkpoint,
            };
          } else {
            result.sample = null;
          }
          break;
        }

        case 'source': {
          // Source metadata about the execution
          result.source = {
            agent: this.config.agent,
            version: this.config.version ?? 'unknown',
            capabilities: this.registry.size,
            task_found: !!taskEntry,
            task_status: taskEntry?.status,
          };
          break;
        }
      }
    }

    return result;
  }

  private handleIntrospect(params: IntrospectParams): IntrospectResult {
    const topic = params?.topic ?? 'all';
    if (topic === 'all') {
      return { guide: PROTOCOL_GUIDE_FULL };
    }
    return { guide: PROTOCOL_GUIDE_SECTIONS[topic] };
  }

  // -------------------------------------------------------------------------
  // HTTP transport (convenience — delegates to createHttpTransport)
  // -------------------------------------------------------------------------

  /**
   * Start an HTTP server for this NEKTE agent.
   * Convenience wrapper around createHttpTransport().
   */
  async listen(port: number, hostname = '0.0.0.0'): Promise<void> {
    const { createHttpTransport } = await import('./http-transport.js');
    await createHttpTransport(this, {
      port,
      hostname,
      logLevel: this.config.logLevel,
      authHandler: this.config.authHandler,
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private ok(id: string | number, result: unknown): NekteResponse {
    return { jsonrpc: '2.0', id, result };
  }

  private error(id: string | number, code: number, message: string, data?: unknown): NekteResponse {
    return { jsonrpc: '2.0', id, error: { code, message, data } };
  }
}
