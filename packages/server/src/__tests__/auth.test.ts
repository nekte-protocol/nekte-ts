import { describe, it, expect } from 'vitest';
import { noAuth, bearerAuth, apiKeyAuth } from '../auth.js';
import type { IncomingMessage } from 'node:http';

function mockReq(headers: Record<string, string> = {}): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

describe('noAuth', () => {
  it('always allows requests', async () => {
    const auth = noAuth();
    const result = await auth(mockReq());
    expect(result).toEqual({ ok: true });
  });
});

describe('bearerAuth', () => {
  const auth = bearerAuth(['token-abc', 'token-xyz']);

  it('allows valid bearer token', async () => {
    const result = await auth(mockReq({ authorization: 'Bearer token-abc' }));
    expect(result.ok).toBe(true);
  });

  it('rejects missing header', async () => {
    const result = await auth(mockReq());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it('rejects wrong scheme', async () => {
    const result = await auth(mockReq({ authorization: 'Basic dXNlcjpwYXNz' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it('rejects invalid token', async () => {
    const result = await auth(mockReq({ authorization: 'Bearer wrong-token' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it('accepts single token as string', async () => {
    const singleAuth = bearerAuth('my-token');
    const result = await singleAuth(mockReq({ authorization: 'Bearer my-token' }));
    expect(result.ok).toBe(true);
  });
});

describe('apiKeyAuth', () => {
  const auth = apiKeyAuth(['key-123', 'key-456']);

  it('allows valid API key', async () => {
    const result = await auth(mockReq({ 'x-api-key': 'key-123' }));
    expect(result.ok).toBe(true);
  });

  it('rejects missing key', async () => {
    const result = await auth(mockReq());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it('rejects invalid key', async () => {
    const result = await auth(mockReq({ 'x-api-key': 'wrong-key' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });
});
