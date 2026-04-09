/**
 * NekteClient — NEKTE protocol client (Hexagonal Architecture)
 *
 * - Progressive discovery (L0 → L1 → L2 on demand)
 * - Zero-schema invocation (version hash cache)
 * - Token budget propagation
 * - Task lifecycle management (cancel, resume, status)
 * - Pluggable transport (HTTP, gRPC, WebSocket)
 *
 * All responses are strongly typed. Streaming returns a DelegateStream
 * with built-in cancel support for natural consumption in agent loops.
 */

import type {
  AgentCard,
  Capability,
  ContextEnvelope,
  DelegateParams,
  DiscoverParams,
  DiscoverResult,
  InvokeParams,
  InvokeResult,
  NekteMethod,
  SseEvent,
  Task,
  TaskCancelParams,
  TaskLifecycleResult,
  TaskResumeParams,
  TaskStatusParams,
  TaskStatusResult,
  TokenBudget,
  VerifyParams,
} from '@nekte/core';
import { createBudget, NEKTE_ERRORS, WELL_KNOWN_PATH } from '@nekte/core';
import { CapabilityCache, type CacheConfig } from './cache.js';
import type { SharedCache } from './shared-cache.js';
import type { Transport, DelegateStream } from './transport.js';
import { HttpTransport } from './http-transport.js';
import { RequestCoalescer } from './request-coalescer.js';

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

export class NekteProtocolError extends Error {
  readonly code: number;
  readonly nekteError: { code: number; message: string; data?: unknown };

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'NekteProtocolError';
    this.code = code;
    this.nekteError = { code, message, data };
  }

  get isVersionMismatch(): boolean {
    return this.code === NEKTE_ERRORS.VERSION_MISMATCH;
  }
  get isCapabilityNotFound(): boolean {
    return this.code === NEKTE_ERRORS.CAPABILITY_NOT_FOUND;
  }
  get isBudgetExceeded(): boolean {
    return this.code === NEKTE_ERRORS.BUDGET_EXCEEDED;
  }
  get isContextExpired(): boolean {
    return this.code === NEKTE_ERRORS.CONTEXT_EXPIRED;
  }
  get isTaskTimeout(): boolean {
    return this.code === NEKTE_ERRORS.TASK_TIMEOUT;
  }
  get isTaskFailed(): boolean {
    return this.code === NEKTE_ERRORS.TASK_FAILED;
  }
  get isTaskNotFound(): boolean {
    return this.code === NEKTE_ERRORS.TASK_NOT_FOUND;
  }
  get isTaskNotCancellable(): boolean {
    return this.code === NEKTE_ERRORS.TASK_NOT_CANCELLABLE;
  }
  get isTaskNotResumable(): boolean {
    return this.code === NEKTE_ERRORS.TASK_NOT_RESUMABLE;
  }
}

// ---------------------------------------------------------------------------
// Client config
// ---------------------------------------------------------------------------

export interface NekteClientConfig {
  /** Cache configuration */
  cache?: CacheConfig;
  /** Shared cache for cross-agent cache sharing */
  sharedCache?: SharedCache;
  /** Default token budget for requests */
  defaultBudget?: Partial<TokenBudget>;
  /** HTTP headers to include in requests (e.g. auth) */
  headers?: Record<string, string>;
  /** Request timeout in ms. Default: 30000 */
  timeoutMs?: number;
  /** Pluggable transport adapter. Default: HttpTransport. */
  transport?: Transport;
}

// ---------------------------------------------------------------------------
// NekteClient
// ---------------------------------------------------------------------------

export class NekteClient {
  readonly endpoint: string;
  readonly cache: CapabilityCache;
  private readonly config: NekteClientConfig;
  private agentId: string | undefined;
  private readonly transport: Transport;
  private readonly coalescer = new RequestCoalescer();

  constructor(endpoint: string, config?: NekteClientConfig) {
    this.endpoint = endpoint.replace(/\/$/, '');
    this.config = config ?? {};

    const cacheConfig: CacheConfig = { ...config?.cache };
    if (config?.sharedCache) {
      cacheConfig.store = config.sharedCache.store();
    }
    this.cache = new CapabilityCache(cacheConfig);

    this.transport =
      config?.transport ??
      new HttpTransport({
        endpoint: this.endpoint,
        headers: config?.headers,
        timeoutMs: config?.timeoutMs,
      });

    // Wire stale-while-revalidate: when a stale entry is accessed,
    // trigger a background discover to refresh it at the same level.
    // Uses the coalescer to prevent duplicate refreshes.
    this.cache.onRevalidate((agentId, capId) => {
      const key = `revalidate:${agentId}:${capId}`;
      this.coalescer.coalesce(key, async () => {
        try {
          // Refresh at the highest level we had cached.
          // Check L2 first, then L1, fallback to L0.
          const level = this.cache.get(agentId, capId, 2)
            ? 2
            : this.cache.get(agentId, capId, 1)
              ? 1
              : 0;
          await this.discover({ level, filter: { id: capId } });
        } catch {
          // Best-effort background refresh — swallow errors
        }
      });
    });
  }

  // -----------------------------------------------------------------------
  // Agent Card
  // -----------------------------------------------------------------------

  async agentCard(): Promise<AgentCard> {
    const res = await this.transport.get<AgentCard>(`${this.endpoint}${WELL_KNOWN_PATH}`);
    this.agentId = res.agent;
    return res;
  }

  // -----------------------------------------------------------------------
  // Discovery
  // -----------------------------------------------------------------------

  async discover(params: DiscoverParams): Promise<DiscoverResult> {
    const result = await this.rpc<DiscoverResult>('nekte.discover', params);

    if (this.agentId) {
      for (const cap of result.caps) {
        this.cache.set(this.agentId, cap, params.level);
      }
    }

    if (!this.agentId) {
      this.agentId = result.agent;
    }

    return result;
  }

  async catalog(filter?: DiscoverParams['filter']): Promise<DiscoverResult> {
    return this.discover({ level: 0, filter });
  }

  async describe(capId: string): Promise<DiscoverResult> {
    return this.discover({ level: 1, filter: { id: capId } });
  }

  async schema(capId: string): Promise<DiscoverResult> {
    return this.discover({ level: 2, filter: { id: capId } });
  }

  // -----------------------------------------------------------------------
  // Invoke
  // -----------------------------------------------------------------------

  async invoke(
    capId: string,
    options: {
      input: Record<string, unknown>;
      budget?: Partial<TokenBudget>;
    },
  ): Promise<InvokeResult> {
    const agentId = this.agentId ?? 'unknown';
    const cachedHash = this.cache.getHash(agentId, capId);
    const budget = createBudget(options.budget ?? this.config.defaultBudget);

    const params: InvokeParams = {
      cap: capId,
      h: cachedHash,
      in: options.input,
      budget,
    };

    try {
      return await this.rpc<InvokeResult>('nekte.invoke', params);
    } catch (err) {
      if (err instanceof NekteProtocolError && err.isVersionMismatch) {
        const data = err.nekteError.data as { schema?: Capability } | undefined;
        if (data?.schema) {
          this.cache.set(agentId, data.schema, 2);
        }
        return this.rpc<InvokeResult>('nekte.invoke', { cap: capId, in: options.input, budget });
      }
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // Delegate (streaming is the only path — no unary delegate)
  // -----------------------------------------------------------------------

  /**
   * Delegate a task with streaming and lifecycle control.
   *
   * Returns a DelegateStream: iterate `events` to consume SSE events,
   * call `cancel()` to abort the task server-side.
   *
   * @example
   * ```ts
   * const stream = client.delegateStream(task);
   * for await (const event of stream.events) {
   *   if (event.event === 'progress') console.log(`${event.data.processed}/${event.data.total}`);
   *   if (event.event === 'complete') console.log('Done:', event.data.out);
   *   if (shouldAbort) await stream.cancel('user requested');
   * }
   * ```
   */
  delegateStream(
    task: Omit<Task, 'budget'> & { budget?: Partial<TokenBudget> },
    context?: ContextEnvelope,
  ): DelegateStream {
    const fullTask: Task = {
      ...task,
      budget: createBudget(task.budget),
    };

    const params: DelegateParams = { task: fullTask, context };
    const events = this.transport.stream('nekte.delegate', params);

    return {
      events,
      taskId: fullTask.id,
      cancel: async (reason?: string) => {
        await this.cancelTask(fullTask.id, reason);
      },
    };
  }

  // -----------------------------------------------------------------------
  // Task Lifecycle
  // -----------------------------------------------------------------------

  async cancelTask(taskId: string, reason?: string): Promise<TaskLifecycleResult> {
    return this.rpc<TaskLifecycleResult>('nekte.task.cancel', {
      task_id: taskId,
      reason,
    } satisfies TaskCancelParams);
  }

  async resumeTask(taskId: string, budget?: Partial<TokenBudget>): Promise<TaskLifecycleResult> {
    return this.rpc<TaskLifecycleResult>('nekte.task.resume', {
      task_id: taskId,
      budget: budget ? createBudget(budget) : undefined,
    } satisfies TaskResumeParams);
  }

  async taskStatus(taskId: string): Promise<TaskStatusResult> {
    return this.rpc<TaskStatusResult>('nekte.task.status', {
      task_id: taskId,
    } satisfies TaskStatusParams);
  }

  // -----------------------------------------------------------------------
  // Verify
  // -----------------------------------------------------------------------

  async verify(
    taskId: string,
    checks: VerifyParams['checks'] = ['hash', 'sample', 'source'],
    budget?: Partial<TokenBudget>,
  ): Promise<unknown> {
    return this.rpc('nekte.verify', {
      task_id: taskId,
      checks,
      budget: budget ? createBudget(budget) : undefined,
    });
  }

  // -----------------------------------------------------------------------
  // Transport
  // -----------------------------------------------------------------------

  private async rpc<T>(method: NekteMethod, params: unknown): Promise<T> {
    const response = await this.transport.rpc<T>(method, params);

    if (response.error) {
      throw new NekteProtocolError(
        response.error.code,
        response.error.message,
        response.error.data,
      );
    }

    return response.result as T;
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}
