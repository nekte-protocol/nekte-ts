/**
 * NEKTE Auth Middleware
 *
 * Validates incoming requests based on the auth method
 * advertised in the Agent Card. Pluggable and simple.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export type AuthResult =
  | { ok: true; identity?: string }
  | { ok: false; status: number; message: string };

export type AuthHandler = (req: IncomingMessage) => AuthResult | Promise<AuthResult>;

/**
 * No authentication — all requests are allowed.
 */
export function noAuth(): AuthHandler {
  return () => ({ ok: true });
}

/**
 * Bearer token authentication.
 * Validates the Authorization header against one or more valid tokens.
 */
export function bearerAuth(tokens: string | string[]): AuthHandler {
  const validTokens = Array.isArray(tokens) ? tokens : [tokens];
  const tokenBuffers = validTokens.map((t) => Buffer.from(t));

  return (req) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return { ok: false, status: 401, message: 'Missing or invalid Authorization header' };
    }

    const token = header.slice(7);
    const tokenBuf = Buffer.from(token);

    for (const valid of tokenBuffers) {
      if (
        tokenBuf.length === valid.length &&
        timingSafeEqual(tokenBuf, valid)
      ) {
        const identity = createHash('sha256').update(token).digest('hex').slice(0, 8);
        return { ok: true, identity };
      }
    }

    return { ok: false, status: 403, message: 'Invalid token' };
  };
}

/**
 * API key authentication.
 * Validates the X-API-Key header against one or more valid keys.
 */
export function apiKeyAuth(keys: string | string[]): AuthHandler {
  const validKeys = Array.isArray(keys) ? keys : [keys];
  const keyBuffers = validKeys.map((k) => Buffer.from(k));

  return (req) => {
    const key = req.headers['x-api-key'] as string | undefined;
    if (!key) {
      return { ok: false, status: 401, message: 'Missing X-API-Key header' };
    }

    const keyBuf = Buffer.from(key);

    for (const valid of keyBuffers) {
      if (
        keyBuf.length === valid.length &&
        timingSafeEqual(keyBuf, valid)
      ) {
        const identity = createHash('sha256').update(key).digest('hex').slice(0, 8);
        return { ok: true, identity };
      }
    }

    return { ok: false, status: 403, message: 'Invalid API key' };
  };
}
