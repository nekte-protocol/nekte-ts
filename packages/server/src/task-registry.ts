/**
 * Task Registry — DDD Repository + Domain Service
 *
 * Manages the lifecycle of delegated tasks. Acts as the single
 * source of truth for task state, providing:
 *
 * - Task registration with AbortController per task
 * - Validated state transitions via the domain state machine
 * - Checkpoint storage for task resume
 * - Cleanup of stale terminal tasks
 *
 * Hexagonal: This is a domain service. It has no transport
 * dependencies — it only depends on @nekte/core domain types.
 */

import type {
  ContextEnvelope,
  Task,
  TaskStatus,
  TaskStatusResult,
  TaskLifecycleResult,
} from '@nekte/core';
import {
  type TaskEntry,
  type TaskCheckpoint,
  createTaskEntry,
  transitionTask,
  saveCheckpoint,
  isTerminal,
  isCancellable,
  isResumable,
  TaskTransitionError,
  NEKTE_ERRORS,
} from '@nekte/core';

// ---------------------------------------------------------------------------
// Domain Events (for transport-agnostic notification)
// ---------------------------------------------------------------------------

export type TaskRegistryEvent =
  | { type: 'registered'; entry: TaskEntry }
  | { type: 'transitioned'; entry: TaskEntry; from: TaskStatus; to: TaskStatus; reason?: string }
  | { type: 'cancelled'; entry: TaskEntry; reason?: string }
  | { type: 'suspended'; entry: TaskEntry }
  | { type: 'resumed'; entry: TaskEntry; fromCheckpoint: boolean }
  | { type: 'checkpoint'; entry: TaskEntry }
  | { type: 'cleaned'; count: number };

export type TaskRegistryListener = (event: TaskRegistryEvent) => void;

// ---------------------------------------------------------------------------
// Registry Errors (protocol-level)
// ---------------------------------------------------------------------------

export class TaskNotFoundError extends Error {
  readonly code = NEKTE_ERRORS.TASK_NOT_FOUND;
  readonly taskId: string;

  constructor(taskId: string) {
    super(`Task not found: ${taskId}`);
    this.name = 'TaskNotFoundError';
    this.taskId = taskId;
  }
}

export class TaskNotCancellableError extends Error {
  readonly code = NEKTE_ERRORS.TASK_NOT_CANCELLABLE;
  readonly taskId: string;
  readonly status: TaskStatus;

  constructor(taskId: string, status: TaskStatus) {
    super(`Task '${taskId}' in '${status}' state cannot be cancelled`);
    this.name = 'TaskNotCancellableError';
    this.taskId = taskId;
    this.status = status;
  }
}

export class TaskNotResumableError extends Error {
  readonly code = NEKTE_ERRORS.TASK_NOT_RESUMABLE;
  readonly taskId: string;
  readonly status: TaskStatus;

  constructor(taskId: string, status: TaskStatus) {
    super(`Task '${taskId}' in '${status}' state cannot be resumed`);
    this.name = 'TaskNotResumableError';
    this.taskId = taskId;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Task Registry
// ---------------------------------------------------------------------------

export interface TaskRegistryConfig {
  /** Max age in ms before terminal tasks are cleaned up. Default: 300_000 (5 min) */
  staleMaxAgeMs?: number;
  /** Auto-cleanup interval in ms. 0 = disabled. Default: 60_000 (1 min) */
  cleanupIntervalMs?: number;
}

export class TaskRegistry {
  private readonly tasks = new Map<string, TaskEntry>();
  private readonly listeners = new Set<TaskRegistryListener>();
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private readonly staleMaxAgeMs: number;

  constructor(config?: TaskRegistryConfig) {
    this.staleMaxAgeMs = config?.staleMaxAgeMs ?? 300_000;
    const interval = config?.cleanupIntervalMs ?? 60_000;
    if (interval > 0) {
      this.cleanupTimer = setInterval(() => this.cleanup(), interval);
      // Unref so the timer doesn't keep the process alive
      if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
        this.cleanupTimer.unref();
      }
    }
  }

  // -----------------------------------------------------------------------
  // Event system
  // -----------------------------------------------------------------------

  /** Subscribe to registry events (transport-agnostic) */
  on(listener: TaskRegistryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: TaskRegistryEvent): void {
    for (const listener of this.listeners) {
      // Emit asynchronously so slow listeners don't block state transitions
      queueMicrotask(() => listener(event));
    }
  }

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  /**
   * Register a new task in 'pending' state.
   * Returns the entry with its AbortController for cancellation signaling.
   */
  register(task: Task, context?: ContextEnvelope): TaskEntry {
    if (this.tasks.has(task.id)) {
      throw new Error(`Task already registered: ${task.id}`);
    }

    const entry = createTaskEntry(task, context);
    this.tasks.set(task.id, entry);
    this.emit({ type: 'registered', entry });
    return entry;
  }

  /** Get a task entry by ID */
  get(taskId: string): TaskEntry | undefined {
    return this.tasks.get(taskId);
  }

  /** Get a task entry or throw TaskNotFoundError */
  getOrThrow(taskId: string): TaskEntry {
    const entry = this.tasks.get(taskId);
    if (!entry) throw new TaskNotFoundError(taskId);
    return entry;
  }

  /** Get all active (non-terminal) tasks */
  active(): TaskEntry[] {
    return Array.from(this.tasks.values()).filter((e) => !isTerminal(e.status));
  }

  /** Get all tasks (for monitoring) */
  all(): TaskEntry[] {
    return Array.from(this.tasks.values());
  }

  /** Total number of tracked tasks */
  get size(): number {
    return this.tasks.size;
  }

  // -----------------------------------------------------------------------
  // State transitions
  // -----------------------------------------------------------------------

  /**
   * Transition a task to a new status with validation.
   * Throws TaskTransitionError if the transition is invalid.
   */
  transition(taskId: string, to: TaskStatus, reason?: string): TaskEntry {
    const entry = this.getOrThrow(taskId);
    const from = entry.status;
    transitionTask(entry, to, reason);
    this.emit({ type: 'transitioned', entry, from, to, reason });
    return entry;
  }

  /**
   * Cancel a task. Fires the AbortController signal.
   * Throws TaskNotCancellableError if the task cannot be cancelled.
   */
  cancel(taskId: string, reason?: string): TaskEntry {
    const entry = this.getOrThrow(taskId);
    if (!isCancellable(entry.status)) {
      throw new TaskNotCancellableError(taskId, entry.status);
    }

    transitionTask(entry, 'cancelled', reason);
    this.emit({ type: 'cancelled', entry, reason });
    return entry;
  }

  /**
   * Suspend a running task with optional checkpoint data.
   */
  suspend(taskId: string, checkpointData?: Record<string, unknown>): TaskEntry {
    const entry = this.getOrThrow(taskId);
    transitionTask(entry, 'suspended');

    if (checkpointData) {
      saveCheckpoint(entry, checkpointData);
      this.emit({ type: 'checkpoint', entry });
    }

    this.emit({ type: 'suspended', entry });
    return entry;
  }

  /**
   * Resume a suspended task.
   * Transitions back to 'running' and returns the entry (with checkpoint if available).
   * Throws TaskNotResumableError if the task cannot be resumed.
   */
  resume(taskId: string): TaskEntry {
    const entry = this.getOrThrow(taskId);
    if (!isResumable(entry.status)) {
      throw new TaskNotResumableError(taskId, entry.status);
    }

    const fromCheckpoint = !!entry.checkpoint;
    transitionTask(entry, 'running', 'Resumed');
    this.emit({ type: 'resumed', entry, fromCheckpoint });
    return entry;
  }

  /**
   * Save a checkpoint on a running/suspended task.
   */
  saveCheckpoint(taskId: string, data: Record<string, unknown>): TaskEntry {
    const entry = this.getOrThrow(taskId);
    saveCheckpoint(entry, data);
    this.emit({ type: 'checkpoint', entry });
    return entry;
  }

  // -----------------------------------------------------------------------
  // Query helpers (LLM-ready structured responses)
  // -----------------------------------------------------------------------

  /** Build a TaskStatusResult for the protocol response */
  toStatusResult(taskId: string): TaskStatusResult {
    const entry = this.getOrThrow(taskId);
    return {
      task_id: entry.task.id,
      status: entry.status,
      checkpoint_available: !!entry.checkpoint,
      created_at: entry.createdAt,
      updated_at: entry.updatedAt,
    };
  }

  /** Build a TaskLifecycleResult after a cancel/resume */
  toLifecycleResult(entry: TaskEntry, previousStatus: TaskStatus): TaskLifecycleResult {
    return {
      task_id: entry.task.id,
      status: entry.status,
      previous_status: previousStatus,
    };
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /** Remove terminal tasks older than maxAge. Returns count removed. */
  cleanup(maxAgeMs?: number): number {
    const threshold = Date.now() - (maxAgeMs ?? this.staleMaxAgeMs);
    let count = 0;

    for (const [id, entry] of this.tasks) {
      if (isTerminal(entry.status) && entry.updatedAt < threshold) {
        this.tasks.delete(id);
        count++;
      }
    }

    if (count > 0) {
      this.emit({ type: 'cleaned', count });
    }

    return count;
  }

  /** Stop the auto-cleanup timer */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.listeners.clear();
  }
}
