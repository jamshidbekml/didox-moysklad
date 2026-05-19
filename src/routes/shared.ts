import { Response } from 'express';
import { vendorApi } from '../services/moysklad';
import { logger } from '../utils/logger';

/**
 * Resolve a MoySklad contextKey to an accountId + display name by calling
 * the Vendor API. Used by handlers in both the settings and didox routers.
 *
 * On any failure, writes the appropriate HTTP error and returns null so the
 * caller can early-return.
 */
export async function resolveAccount(
  contextKey: string | undefined,
  res: Response
): Promise<{ accountId: string; userName: string } | null> {
  if (!contextKey) {
    res.status(400).json({ error: 'missing_context_key' });
    return null;
  }
  try {
    const user = (await vendorApi.getUserContext(contextKey)) as {
      accountId?: string;
      name?: string;
      fullName?: string;
    };
    if (!user.accountId) {
      res.status(401).json({ error: 'invalid_context' });
      return null;
    }
    return { accountId: user.accountId, userName: user.fullName || user.name || '' };
  } catch (err) {
    logger.error({ err }, 'getUserContext failed');
    res.status(401).json({ error: 'context_resolution_failed' });
    return null;
  }
}
