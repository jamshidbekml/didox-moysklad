import { Response } from 'express';
import {
  didoxApi,
  DidoxApiError,
  DidoxInvalidCredentialsError,
  DidoxUserNotRegisteredError,
} from '../../services/didox';
import { logger } from '../../utils/logger';

/**
 * Validate credentials against Didox by exchanging tin+password for a token.
 * On failure, writes the appropriate HTTP error and returns null so the
 * caller can `return`. On success, returns the issued token (callers may
 * choose to discard it; the next request will fetch a fresh one).
 */
export async function validateDidoxCredentials(
  tin: string,
  password: string,
  res: Response
): Promise<string | null> {
  try {
    const { token } = await didoxApi.getToken({ inn: tin, password });
    return token;
  } catch (err) {
    if (err instanceof DidoxInvalidCredentialsError) {
      res.status(422).json({ error: 'didox_invalid_credentials' });
      return null;
    }
    if (err instanceof DidoxUserNotRegisteredError) {
      res.status(422).json({ error: 'didox_user_not_registered' });
      return null;
    }
    const status = err instanceof DidoxApiError ? err.status || 502 : 502;
    logger.error({ err }, 'Didox credential validation failed');
    res.status(502).json({ error: 'didox_upstream_error', upstreamStatus: status });
    return null;
  }
}
