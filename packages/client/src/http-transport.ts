/**
 * HTTP Transport Adapter — Infrastructure Layer
 *
 * Default transport implementation using fetch().
 * Handles JSON-RPC over HTTP POST and SSE streaming for delegate.
 *
 * Hexagonal: This is an adapter for the Transport port.
 * Extracted from the original NekteClient to enable transport swapping.
 */

import type { NekteMethod, NekteRequest, NekteResponse, SseEvent } from '@nekte/core';
import { parseSseEvent } from '@nekte/core';
import type { Transport } from './transport.js';

export interface HttpTransportConfig {
  /** Base endpoint URL */
  endpoint: string;
  /** HTTP headers to include (e.g., auth tokens) */
  headers?: Record<string, string>;
  /** Request timeout in ms. Default: 30_000 */
  timeoutMs?: number;
}

export class HttpTransport implements Transport {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private requestId = 0;

  constructor(config: HttpTransportConfig) {
    this.endpoint = config.endpoint.replace(/\/$/, '');
    this.headers = config.headers ?? {};
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  async rpc<T>(method: NekteMethod, params: unknown): Promise<NekteResponse<T>> {
    const request: NekteRequest = {
      jsonrpc: '2.0',
      method,
      id: ++this.requestId,
      params,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.headers },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      return (await res.json()) as NekteResponse<T>;
    } finally {
      clearTimeout(timeout);
    }
  }

  async *stream(method: NekteMethod, params: unknown): AsyncGenerator<SseEvent> {
    const request: NekteRequest = {
      jsonrpc: '2.0',
      method,
      id: ++this.requestId,
      params,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs * 2);

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.headers },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      if (!res.body) {
        throw new Error('No response body for SSE stream');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop()!;

        for (const part of parts) {
          if (!part.trim()) continue;
          const event = parseSseEvent(part);
          if (event) yield event;
        }
      }

      if (buffer.trim()) {
        const event = parseSseEvent(buffer);
        if (event) yield event;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async get<T>(url: string): Promise<T> {
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return (await res.json()) as T;
  }

  async close(): Promise<void> {
    // HTTP transport is stateless — nothing to close
  }
}
