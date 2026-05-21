import { didoxApi, DidoxApiError } from './didox';
import { installationStore } from './store';
import { logger } from '../utils/logger';

/**
 * Didox user-tokens are valid for ~6 hours. We cache them in the installation
 * row and reuse until they're within REFRESH_BUFFER_MS of expiry.
 */
const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Return a valid Didox user-token for the given account, minting a new one
 * via /v1/auth if no cached token exists or the cached one is near expiry.
 *
 * Throws DidoxApiError variants (DidoxInvalidCredentialsError, etc.) when a
 * fresh mint is needed but the stored credentials are rejected. Throws
 * `didox_credentials_not_configured` if settings are missing.
 */
export async function getCachedDidoxToken(accountId: string): Promise<string> {
  const install = await installationStore.get(accountId);
  const settings = install?.settings;
  if (!settings?.didoxTin || !settings.didoxPassword) {
    throw new Error('didox_credentials_not_configured');
  }

  const expiresAt = settings.didoxTokenExpiresAt
    ? new Date(settings.didoxTokenExpiresAt).getTime()
    : 0;
  if (settings.didoxToken && expiresAt - Date.now() > REFRESH_BUFFER_MS) {
    return settings.didoxToken;
  }

  const { token } = await didoxApi.getToken({
    inn: settings.didoxTin,
    password: settings.didoxPassword,
  });
  await installationStore.updateSettings(accountId, {
    didoxToken: token,
    didoxTokenExpiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  });
  return token;
}

/** Clear the cached token so the next getCachedDidoxToken refetches. */
export async function invalidateDidoxToken(accountId: string): Promise<void> {
  await installationStore.clearDidoxToken(accountId);
}

/**
 * Run a Didox API call with a cached token, transparently refreshing once
 * if the call fails with 401 (token revoked / expired earlier than expected).
 */
export async function withDidoxToken<T>(
  accountId: string,
  fn: (token: string) => Promise<T>
): Promise<T> {
  const token = await getCachedDidoxToken(accountId);
  try {
    return await fn(token);
  } catch (err) {
    if (err instanceof DidoxApiError && err.status === 401) {
      logger.info({ accountId }, 'Didox 401 with cached token — refreshing and retrying once');
      await invalidateDidoxToken(accountId);
      const fresh = await getCachedDidoxToken(accountId);
      return await fn(fresh);
    }
    throw err;
  }
}
