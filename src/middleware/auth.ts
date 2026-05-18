import { Request, Response, NextFunction } from 'express';
import { verifyIncomingJwt, JwtVerificationError } from '../services/jwt';
import { logger } from '../utils/logger';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      jwt?: {
        iat: number;
        exp: number;
        jti: string;
      };
      requestId?: string;
    }
  }
}

/**
 * Extracts and verifies the Authorization: Bearer <jwt> header.
 * Attaches the decoded payload to req.jwt for downstream handlers.
 *
 * MoySklad signs every request to our Vendor API endpoints. If verification
 * fails we return 401 — MoySklad will retry per the Retry policy for 5xx, but
 * 4xx is treated as a permanent failure, so be careful not to return 4xx for
 * intermittent issues.
 */
export function requireVendorJwt(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const auth = req.header('authorization') || req.header('Authorization');
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
    logger.warn({ path: req.path }, 'Missing Authorization header');
    res.status(401).json({ error: 'missing_authorization' });
    return;
  }

  const token = auth.slice('bearer '.length).trim();

  try {
    const payload = verifyIncomingJwt(token);
    req.jwt = payload;
    next();
  } catch (err) {
    if (err instanceof JwtVerificationError) {
      logger.warn(
        { reason: err.reason, message: err.message, path: req.path },
        'JWT verification failed'
      );
      res.status(401).json({ error: 'invalid_token', reason: err.reason });
      return;
    }
    next(err);
  }
}

/**
 * Captures X_Lognex_RequestId for log correlation across Retry attempts.
 */
export function captureRequestId(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const requestId =
    req.header('x_lognex_requestid') ||
    req.header('X_Lognex_RequestId') ||
    req.header('x-lognex-requestid');
  if (requestId) {
    req.requestId = requestId;
  }
  next();
}
