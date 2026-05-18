import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * JWT handling for Vendor API per the spec at
 * https://dev.moysklad.ru/doc/api/vendor/1.0/#vendor-api-1-0-autentifikaciq-wzaimodejstwiq-po-vendor-api
 *
 * Algorithm: HS256 (HMAC SHA-256) using secretKey.
 *
 * Incoming requests (MoySklad → us):
 *   - Payload must include: iat, exp, jti
 *   - We must reject replayed jti values within the token's validity window
 *
 * Outgoing requests (us → MoySklad):
 *   - Payload must include: sub (appUid), iat, jti
 *   - Optional: exp
 *   - Token is one-time-use; we generate fresh jti for every call
 */

interface IncomingJwtPayload {
  iat: number;
  exp: number;
  jti: string;
}

interface OutgoingJwtPayload {
  sub: string;
  iat: number;
  exp?: number;
  jti: string;
}

/**
 * Simple in-memory replay-protection cache.
 * Tracks seen jti values until their natural exp.
 * For multi-instance deployments, replace with Redis (key = jti, TTL = exp - now).
 */
class JtiCache {
  private store = new Map<string, number>();

  has(jti: string): boolean {
    this.evictExpired();
    return this.store.has(jti);
  }

  add(jti: string, expSeconds: number): void {
    this.store.set(jti, expSeconds);
  }

  private evictExpired(): void {
    const nowSec = Math.floor(Date.now() / 1000);
    for (const [jti, expSec] of this.store.entries()) {
      if (expSec < nowSec) {
        this.store.delete(jti);
      }
    }
  }

  size(): number {
    return this.store.size;
  }
}

const jtiCache = new JtiCache();

export class JwtVerificationError extends Error {
  constructor(
    message: string,
    public readonly reason: 'invalid' | 'expired' | 'replay' | 'malformed'
  ) {
    super(message);
    this.name = 'JwtVerificationError';
  }
}

/**
 * Verify a JWT received from MoySklad in the Authorization header.
 * Throws JwtVerificationError on any problem.
 */
export function verifyIncomingJwt(token: string): IncomingJwtPayload {
  let decoded: jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, config.moysklad.secretKey, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new JwtVerificationError('Token expired', 'expired');
    }
    throw new JwtVerificationError(
      err instanceof Error ? err.message : 'Invalid token',
      'invalid'
    );
  }

  const { iat, exp, jti } = decoded;
  if (
    typeof iat !== 'number' ||
    typeof exp !== 'number' ||
    typeof jti !== 'string'
  ) {
    throw new JwtVerificationError(
      'Missing required claims (iat, exp, jti)',
      'malformed'
    );
  }

  if (jtiCache.has(jti)) {
    throw new JwtVerificationError(`Replayed jti: ${jti}`, 'replay');
  }
  jtiCache.add(jti, exp);

  return { iat, exp, jti };
}

/**
 * Generate a one-time JWT for outgoing requests to MoySklad.
 */
export function signOutgoingJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: OutgoingJwtPayload = {
    sub: config.moysklad.appUid,
    iat: now,
    exp: now + config.jwt.lifetimeSeconds,
    jti: uuidv4(),
  };

  const token = jwt.sign(payload, config.moysklad.secretKey, {
    algorithm: 'HS256',
  });

  logger.debug({ jti: payload.jti, exp: payload.exp }, 'Signed outgoing JWT');
  return token;
}

/** Exposed for testing/monitoring */
export function jtiCacheSize(): number {
  return jtiCache.size();
}
