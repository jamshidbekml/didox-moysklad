import { Response } from 'express';
import {
  didoxApi,
  DidoxInvalidCredentialsError,
  DidoxUserNotRegisteredError,
} from '../../services/didox';
import { installationStore } from '../../services/store';
import { logger } from '../../utils/logger';
import { resolveAccount } from '../shared';

/**
 * Resolve contextKey → accountId, load the stored Didox credentials, and
 * exchange them for a fresh user-token. Writes the appropriate HTTP error
 * and returns null if any step fails.
 *
 * Used by every Didox-document endpoint that needs to call the Didox API
 * on behalf of the current MoySklad account.
 */
export async function resolveDidoxSession(
  contextKey: string | undefined,
  res: Response
): Promise<{ accountId: string; userToken: string } | null> {
  const resolved = await resolveAccount(contextKey, res);
  if (!resolved) return null;

  const install = await installationStore.get(resolved.accountId);
  if (!install?.settings?.configured || !install.settings.didoxTin || !install.settings.didoxPassword) {
    res.status(412).json({ error: 'settings_not_configured' });
    return null;
  }

  try {
    const { token } = await didoxApi.getToken({
      inn: install.settings.didoxTin,
      password: install.settings.didoxPassword,
    });
    return { accountId: resolved.accountId, userToken: token };
  } catch (err) {
    if (err instanceof DidoxInvalidCredentialsError) {
      res.status(401).json({ error: 'didox_invalid_credentials' });
      return null;
    }
    if (err instanceof DidoxUserNotRegisteredError) {
      res.status(401).json({ error: 'didox_user_not_registered' });
      return null;
    }
    logger.error({ err, accountId: resolved.accountId }, 'Didox auth failed');
    res.status(502).json({ error: 'didox_upstream_error' });
    return null;
  }
}
