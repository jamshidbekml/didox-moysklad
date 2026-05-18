import { AccountInstallation, AccountSettings } from '../types/vendor';
import { logger } from '../utils/logger';

/**
 * In-memory store for MVP.
 *
 * PRODUCTION: replace with a real database (Postgres recommended).
 * Schema sketch:
 *   accountId UUID PK
 *   app_uid TEXT
 *   account_name TEXT
 *   status TEXT
 *   access_token TEXT  (encrypt at rest)
 *   subscription_json JSONB
 *   settings_json JSONB
 *   installed_at TIMESTAMPTZ
 *   updated_at TIMESTAMPTZ
 *
 * Notes:
 *   - access_token should be encrypted with a KMS-backed key
 *   - settings_json may contain Didox credentials - same treatment
 *   - keep retention after Uninstall for at least 30 days so re-installs preserve settings
 */
export class InstallationStore {
  private map = new Map<string, AccountInstallation>();

  get(accountId: string): AccountInstallation | undefined {
    return this.map.get(accountId);
  }

  upsert(install: AccountInstallation): AccountInstallation {
    const existing = this.map.get(install.accountId);
    const merged: AccountInstallation = {
      ...existing,
      ...install,
      settings: { ...existing?.settings, ...install.settings },
      updatedAt: new Date().toISOString(),
    };
    this.map.set(install.accountId, merged);
    logger.info(
      {
        accountId: merged.accountId,
        status: merged.status,
        accountName: merged.accountName,
      },
      'Installation upserted'
    );
    return merged;
  }

  markDeactivated(accountId: string): void {
    const existing = this.map.get(accountId);
    if (!existing) {
      return;
    }
    this.map.set(accountId, {
      ...existing,
      status: 'Deactivated',
      accessToken: undefined,
      updatedAt: new Date().toISOString(),
    });
    logger.info({ accountId }, 'Installation marked Deactivated');
  }

  updateSettings(
    accountId: string,
    patch: Partial<AccountSettings>
  ): AccountInstallation | undefined {
    const existing = this.map.get(accountId);
    if (!existing) {
      return undefined;
    }
    const updated: AccountInstallation = {
      ...existing,
      settings: { ...existing.settings, ...patch },
      updatedAt: new Date().toISOString(),
    };
    this.map.set(accountId, updated);
    return updated;
  }

  list(): AccountInstallation[] {
    return Array.from(this.map.values());
  }
}

export const installationStore = new InstallationStore();
