import { AccountInstallation, AccountSettings, Subscription } from '../types/vendor';
import { logger } from '../utils/logger';
import { UserModel } from '../models/user';
import { decrypt, encrypt, EncryptedField, isEncryptedField } from '../utils/crypto';

/**
 * MongoDB-backed installation store.
 *
 * Encryption at rest:
 *   - accessToken (MoySklad)
 *   - settings.didoxPassword (Didox account password)
 * Both are AES-256-GCM via ENCRYPTION_KEY. The repo decrypts on read so
 * callers always see plaintext.
 *
 * Retention: marking an installation Deactivated keeps the row so a re-install
 * can preserve settings. Sensitive fields are cleared on deactivation.
 */

interface StoredSubscription {
  tariffId: string;
  trial: boolean;
  tariffName?: string | null;
  expiryMoment?: string | null;
  notForResale: boolean;
  partner: boolean;
}

interface StoredSettings {
  didoxTin?: string | null;
  didoxPassword?: EncryptedField | null;
  autoSendDemand?: boolean | null;
  configured?: boolean | null;
  didoxToken?: EncryptedField | null;
  didoxTokenExpiresAt?: Date | null;
}

interface StoredUser {
  accountId: string;
  appUid: string;
  accountName: string;
  status: AccountInstallation['status'];
  accessToken?: EncryptedField | null;
  subscription?: StoredSubscription | null;
  settings?: StoredSettings | null;
  installedAt: Date;
  updatedAt?: Date;
}

function toSubscription(s: StoredSubscription | null | undefined): Subscription | undefined {
  if (!s) return undefined;
  return {
    tariffId: s.tariffId,
    trial: s.trial,
    tariffName: s.tariffName ?? undefined,
    expiryMoment: s.expiryMoment ?? undefined,
    notForResale: s.notForResale,
    partner: s.partner,
  };
}

function toSettings(s: StoredSettings | null | undefined): AccountSettings | undefined {
  if (!s) return undefined;
  return {
    didoxTin: s.didoxTin ?? undefined,
    autoSendDemand: s.autoSendDemand ?? undefined,
    configured: s.configured ?? undefined,
    didoxPassword: isEncryptedField(s.didoxPassword) ? decrypt(s.didoxPassword) : undefined,
    didoxToken: isEncryptedField(s.didoxToken) ? decrypt(s.didoxToken) : undefined,
    didoxTokenExpiresAt: s.didoxTokenExpiresAt ? s.didoxTokenExpiresAt.toISOString() : undefined,
  };
}

function toInstallation(doc: StoredUser): AccountInstallation {
  return {
    accountId: doc.accountId,
    appUid: doc.appUid,
    accountName: doc.accountName,
    status: doc.status,
    accessToken: isEncryptedField(doc.accessToken) ? decrypt(doc.accessToken) : undefined,
    subscription: toSubscription(doc.subscription),
    settings: toSettings(doc.settings),
    installedAt: doc.installedAt.toISOString(),
    updatedAt: (doc.updatedAt ?? new Date()).toISOString(),
  };
}

export class InstallationStore {
  async get(accountId: string): Promise<AccountInstallation | undefined> {
    const doc = await UserModel.findOne({ accountId }).lean<StoredUser | null>();
    return doc ? toInstallation(doc) : undefined;
  }

  async upsert(install: AccountInstallation): Promise<AccountInstallation> {
    const set: Record<string, unknown> = {
      appUid: install.appUid,
      accountName: install.accountName,
      status: install.status,
      subscription: install.subscription,
    };

    if (install.accessToken !== undefined) {
      set.accessToken = encrypt(install.accessToken);
    }

    if (install.settings) {
      const { didoxPassword, didoxToken, didoxTokenExpiresAt, ...rest } = install.settings;
      const settingsToStore: Record<string, unknown> = { ...rest };
      if (didoxPassword !== undefined) {
        settingsToStore.didoxPassword = encrypt(didoxPassword);
      }
      if (didoxToken !== undefined) {
        settingsToStore.didoxToken = encrypt(didoxToken);
      }
      if (didoxTokenExpiresAt !== undefined) {
        settingsToStore.didoxTokenExpiresAt = new Date(didoxTokenExpiresAt);
      }
      set.settings = settingsToStore;
    }

    const doc = await UserModel.findOneAndUpdate(
      { accountId: install.accountId },
      {
        $set: set,
        $setOnInsert: {
          accountId: install.accountId,
          installedAt: new Date(install.installedAt),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean<StoredUser>();

    logger.info(
      {
        accountId: doc.accountId,
        status: doc.status,
        accountName: doc.accountName,
      },
      'Installation upserted'
    );
    return toInstallation(doc);
  }

  async markDeactivated(accountId: string): Promise<void> {
    const result = await UserModel.updateOne(
      { accountId },
      { $set: { status: 'Deactivated' }, $unset: { accessToken: '' } }
    );
    if (result.matchedCount === 0) {
      return;
    }
    logger.info({ accountId }, 'Installation marked Deactivated');
  }

  async updateSettings(
    accountId: string,
    patch: Partial<AccountSettings>
  ): Promise<AccountInstallation | undefined> {
    const set: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'didoxPassword') {
        if (typeof value === 'string') {
          set['settings.didoxPassword'] = encrypt(value);
        }
        continue;
      }
      if (key === 'didoxToken') {
        if (typeof value === 'string') {
          set['settings.didoxToken'] = encrypt(value);
        }
        continue;
      }
      if (key === 'didoxTokenExpiresAt') {
        if (typeof value === 'string') {
          set['settings.didoxTokenExpiresAt'] = new Date(value);
        }
        continue;
      }
      set[`settings.${key}`] = value;
    }

    if (Object.keys(set).length === 0) {
      const doc = await UserModel.findOne({ accountId }).lean<StoredUser | null>();
      return doc ? toInstallation(doc) : undefined;
    }

    const doc = await UserModel.findOneAndUpdate(
      { accountId },
      { $set: set },
      { new: true }
    ).lean<StoredUser | null>();
    return doc ? toInstallation(doc) : undefined;
  }

  /**
   * Drop the cached Didox token. Used when the upstream API rejects the
   * cached token (e.g. revoked early); the next call will mint a fresh one.
   */
  async clearDidoxToken(accountId: string): Promise<void> {
    await UserModel.updateOne(
      { accountId },
      { $unset: { 'settings.didoxToken': '', 'settings.didoxTokenExpiresAt': '' } }
    );
  }

  async list(): Promise<AccountInstallation[]> {
    const docs = await UserModel.find().lean<StoredUser[]>();
    return docs.map(toInstallation);
  }
}

export const installationStore = new InstallationStore();
