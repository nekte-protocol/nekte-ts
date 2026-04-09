/**
 * SSE Stream — Server-Sent Events writer for NekteServer
 *
 * Wraps an HTTP ServerResponse to emit typed NEKTE SSE events.
 * Used for streaming delegate results back to the client.
 *
 * @example
 * ```ts
 * const stream = new SseStream(res);
 * stream.progress(50, 500, 'Processing reviews...');
 * stream.partial({ preliminary_score: 0.72 });
 * stream.complete('task-001', { minimal: '72% positive', compact: {...}, full: {...} });
 * ```
 */

import type { ServerResponse } from 'node:http';
import type { DetailLevel, MultiLevelResult, SseEvent, TaskStatus } from '@nekte/core';
import { encodeSseEvent, SSE_CONTENT_TYPE } from '@nekte/core';

export class SseStream {
  private res: ServerResponse;
  private closed = false;
  private drainListener: (() => void) | null = null;

  constructor(res: ServerResponse) {
    this.res = res;
    this.res.writeHead(200, {
      'Content-Type': SSE_CONTENT_TYPE,
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    });
  }

  /** Send a progress event */
  progress(processed: number, total: number, message?: string): void {
    this.send({
      event: 'progress',
      data: { processed, total, ...(message && { message }) },
    });
  }

  /** Send a partial result (preliminary data) */
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
      data: { task_id: taskId, status: 'completed', out, ...(meta && { meta }) },
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

  /** Send a raw SSE event with backpressure awareness */
  send(event: SseEvent): void {
    if (this.closed || this.res.writableEnded) return;
    const ok = this.res.write(encodeSseEvent(event));
    // If the kernel buffer is full, wait for drain before sending more
    if (!ok && !this.closed) {
      // Clean up previous drain listener if still attached
      if (this.drainListener) {
        this.res.removeListener('drain', this.drainListener);
      }
      this.drainListener = () => {
        this.drainListener = null;
      };
      this.res.once('drain', this.drainListener);
    }
  }

  /** Close the stream */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    // Clean up drain listener to prevent leaks
    if (this.drainListener) {
      this.res.removeListener('drain', this.drainListener);
      this.drainListener = null;
    }
    this.res.end();
  }

  /** Whether the stream has been closed */
  get isClosed(): boolean {
    return this.closed;
  }
}
