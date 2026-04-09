/**
 * gRPC Delegate Stream — Infrastructure Adapter
 *
 * Implements the same streaming interface as SseStream but
 * writes proto DelegateEvent messages to a gRPC server-streaming call.
 *
 * This adapter allows DelegateHandlers to work identically
 * regardless of whether the transport is HTTP/SSE or gRPC.
 *
 * Hexagonal: Adapter for the streaming output port.
 */

import type { DetailLevel, MultiLevelResult, SseEvent, TaskStatus } from '@nekte/core';
import { toProtoDelegateEvent } from '@nekte/core';

/** Minimal gRPC writable stream interface (no dependency on @grpc/grpc-js) */
export interface GrpcWritableStream {
  write(message: unknown): boolean;
  end(): void;
}

export class GrpcDelegateStream {
  private stream: GrpcWritableStream;
  private closed = false;

  constructor(stream: GrpcWritableStream) {
    this.stream = stream;
  }

  /** Send a progress event */
  progress(processed: number, total: number, message?: string): void {
    this.send({
      event: 'progress',
      data: { processed, total, ...(message && { message }) },
    });
  }

  /** Send a partial result */
  partial(out: Record<string, unknown>, resolvedLevel?: DetailLevel): void {
    this.send({
      event: 'partial',
      data: { out, ...(resolvedLevel && { resolved_level: resolvedLevel }) },
    });
  }

  /** Send completion event and close the stream */
  complete(
    taskId: string,
    out: MultiLevelResult,
    meta?: { ms?: number; tokens_used?: number },
  ): void {
    this.send({
      event: 'complete',
      data: { task_id: taskId, status: 'completed' as const, out, ...(meta && { meta }) },
    });
    this.close();
  }

  /** Send error event and close the stream */
  error(code: number, message: string, taskId?: string): void {
    this.send({
      event: 'error',
      data: { code, message, ...(taskId && { task_id: taskId }) },
    });
    this.close();
  }

  /** Send a cancelled event */
  cancelled(taskId: string, previousStatus: TaskStatus, reason?: string): void {
    this.send({
      event: 'cancelled',
      data: { task_id: taskId, previous_status: previousStatus, ...(reason && { reason }) },
    });
    this.close();
  }

  /** Send a suspended event */
  suspended(taskId: string, checkpointAvailable: boolean): void {
    this.send({
      event: 'suspended',
      data: { task_id: taskId, checkpoint_available: checkpointAvailable },
    });
  }

  /** Send a resumed event */
  resumed(taskId: string, fromCheckpoint: boolean): void {
    this.send({
      event: 'resumed',
      data: { task_id: taskId, from_checkpoint: fromCheckpoint },
    });
  }

  /** Send a status change event */
  statusChange(taskId: string, from: TaskStatus, to: TaskStatus, reason?: string): void {
    this.send({
      event: 'status_change',
      data: { task_id: taskId, from, to, ...(reason && { reason }) },
    });
  }

  /** Send a raw SSE event (converted to proto) */
  send(event: SseEvent): void {
    if (this.closed) return;
    const protoEvent = toProtoDelegateEvent(event);
    this.stream.write(protoEvent);
  }

  /** Close the gRPC stream */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stream.end();
  }

  /** Whether the stream has been closed */
  get isClosed(): boolean {
    return this.closed;
  }
}
