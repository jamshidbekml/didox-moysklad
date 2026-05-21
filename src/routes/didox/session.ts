import { Response } from 'express';
import {
  DidoxApiError,
  DidoxInvalidCredentialsError,
  DidoxUserNotRegisteredError,
} from '../../services/didox';
import { installationStore } from '../../services/store';
import { logger } from '../../utils/logger';
import { resolveAccount } from '../shared';

/**
 * Resolve contextKey → accountId and confirm Didox credentials are configured.
 * Writes the appropriate HTTP error and returns null if any check fails.
 *
 * The Didox user-token is no longer fetched here — callers use
 * `withDidoxToken(accountId, fn)` from services/didox-auth so the cached
 * token is reused across requests and refreshed on 401.
 */
export async function resolveDidoxSession(
  contextKey: string | undefined,
  res: Response
): Promise<{ accountId: string } | null> {
  const resolved = await resolveAccount(contextKey, res);
  if (!resolved) return null;

  const install = await installationStore.get(resolved.accountId);
  if (!install?.settings?.configured || !install.settings.didoxTin || !install.settings.didoxPassword) {
    res.status(412).json({ error: 'settings_not_configured' });
    return null;
  }

  return { accountId: resolved.accountId };
}

/**
 * Map a Didox API error to an HTTP response. Shared by every route that
 * proxies a Didox call — keeps the 401 / 422 / 502 mapping consistent.
 */
export function sendDidoxError(res: Response, accountId: string, err: unknown, logCtx?: Record<string, unknown>): void {
  if (err instanceof DidoxInvalidCredentialsError) {
    res.status(401).json({ error: 'didox_invalid_credentials' });
    return;
  }
  if (err instanceof DidoxUserNotRegisteredError) {
    res.status(401).json({ error: 'didox_user_not_registered' });
    return;
  }
  const status = err instanceof DidoxApiError ? err.status || 502 : 502;
  logger.error({ err, accountId, ...logCtx }, 'Didox upstream call failed');
  res.status(502).json({ error: 'didox_upstream_error', upstreamStatus: status });
}
