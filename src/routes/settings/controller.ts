import { Request, Response } from 'express';
import { config } from '../../config';
import { TIN_RE } from '../../constants/validation';
import { vendorApi } from '../../services/moysklad';
import { installationStore } from '../../services/store';
import { AccountSettings } from '../../types/vendor';
import { logger } from '../../utils/logger';
import { resolveAccount } from '../shared';
import { validateDidoxCredentials } from './helpers';
import { renderSettingsIframe } from './template';

/**
 * GET /settings/iframe
 * Main iframe page MoySklad loads in the solution's iframe slot.
 *
 * Query parameters received:
 *   contextKey - one-time key (5-min TTL) to resolve user info via Vendor API
 *   appUid     - our solution's appUid
 *   appId      - our solution's appId
 *   userLocale - ru_RU | en_US
 */
export function getIframe(req: Request, res: Response): void {
  const contextKey = String(req.query.contextKey ?? '');
  const userLocale = String(req.query.userLocale ?? 'ru_RU');

  if (!contextKey) {
    res.status(400).send('Missing contextKey');
    return;
  }

  res.type('html').send(renderSettingsIframe({ contextKey, userLocale }));
}

/**
 * GET /settings/bootstrap
 * Returns user + settings + a `hasSettings` flag the iframe uses to decide
 * whether to show the form or redirect to the documents page.
 *
 * Note on auth: we deliberately don't require the Vendor JWT here — this is
 * called from the browser inside the MoySklad iframe and the only secret it
 * carries is the contextKey, which has a 5-minute TTL and is meaningful only
 * to MoySklad. We re-validate it by exchanging it for a user context.
 */
export async function getBootstrap(req: Request, res: Response): Promise<void> {
  const resolved = await resolveAccount(String(req.query.contextKey ?? ''), res);
  if (!resolved) return;

  const install = await installationStore.get(resolved.accountId);

  // If MoySklad activation set status=SettingsRequired and the user has since
  // saved settings, flip the vendor status to Activated. Fire-and-forget so
  // bootstrap latency isn't tied to the vendor round-trip; the next iframe
  // load will retry if this attempt fails.
  if (install?.settings?.configured && install.status === 'SettingsRequired') {
    const snapshot = install;
    void (async () => {
      try {
        await vendorApi.updateStatus(snapshot.accountId, 'Activated');
        await installationStore.upsert({
          ...snapshot,
          status: 'Activated',
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        logger.error({ err, accountId: snapshot.accountId }, 'Failed to transition to Activated');
      }
    })();
  }

  // Never send the decrypted Didox password to the browser.
  const { didoxPassword: _omit, ...safeSettings } = install?.settings ?? {};
  void _omit;
  res.json({
    user: { name: resolved.userName },
    settings: safeSettings,
    hasSettings: Boolean(install?.settings?.configured),
  });
}

/**
 * POST /settings/create
 * First-time settings save. Both didoxTin and didoxPassword are required.
 * Creates the installation row (with placeholder accountName) if it doesn't
 * exist yet — covers the case where the iframe is opened before MoySklad's
 * vendor activation webhook has fired.
 *
 * Refuses (409) if settings are already configured — use /update instead.
 */
export async function postCreate(req: Request, res: Response): Promise<void> {
  const { contextKey, didoxTin, didoxPassword, autoSendDemand } = req.body as {
    contextKey?: string;
    didoxTin?: string;
    didoxPassword?: string;
    autoSendDemand?: boolean;
  };

  const resolved = await resolveAccount(contextKey, res);
  if (!resolved) return;
  const { accountId, userName } = resolved;

  if (!didoxTin || !TIN_RE.test(didoxTin)) {
    res.status(400).json({ error: 'didoxTin must be 9 (СТИР) or 14 (ЖШШИР) digits' });
    return;
  }
  if (!didoxPassword) {
    res.status(400).json({ error: 'didoxPassword is required' });
    return;
  }

  const existing = await installationStore.get(accountId);
  if (existing?.settings?.configured) {
    res.status(409).json({ error: 'settings_already_exist' });
    return;
  }

  // Verify the supplied credentials against Didox before persisting them.
  const token = await validateDidoxCredentials(didoxTin, didoxPassword, res);
  if (!token) return;

  // Create installation row if missing (vendor activation hasn't fired yet),
  // otherwise just attach settings to the existing row.
  const baseInstall = existing ?? {
    accountId,
    appUid: config.moysklad.appUid,
    accountName: userName,
    status: 'Activated' as const,
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const settings: AccountSettings = {
    didoxTin,
    didoxPassword,
    autoSendDemand: Boolean(autoSendDemand),
    configured: true,
  };

  await installationStore.upsert({ ...baseInstall, settings });

  // First-time success: tell the client to navigate to the documents page.
  res.status(201).json({
    ok: true,
    redirect: `/settings/documents?contextKey=${encodeURIComponent(contextKey ?? '')}`,
  });
}

/**
 * POST /settings/update
 * Update existing settings. All fields are optional; an empty password keeps
 * the current value. Requires settings to already be configured (use /create
 * for the first save).
 */
export async function postUpdate(req: Request, res: Response): Promise<void> {
  const { contextKey, didoxTin, didoxPassword, autoSendDemand } = req.body as {
    contextKey?: string;
    didoxTin?: string;
    didoxPassword?: string;
    autoSendDemand?: boolean;
  };

  const resolved = await resolveAccount(contextKey, res);
  if (!resolved) return;
  const { accountId } = resolved;

  if (didoxTin && !TIN_RE.test(didoxTin)) {
    res.status(400).json({ error: 'didoxTin must be 9 (СТИР) or 14 (ЖШШИР) digits' });
    return;
  }

  const existing = await installationStore.get(accountId);
  if (!existing?.settings?.configured) {
    res.status(404).json({ error: 'settings_not_found' });
    return;
  }

  // Only revalidate against Didox if tin or password is actually changing.
  // (Avoids an extra round-trip when the user only toggles autoSendDemand.)
  const credsChanging = Boolean(didoxTin || didoxPassword);
  if (credsChanging) {
    const effectiveTin = didoxTin || existing.settings.didoxTin;
    const effectivePassword = didoxPassword || existing.settings.didoxPassword;
    if (!effectiveTin || !effectivePassword) {
      res.status(400).json({ error: 'missing_credentials' });
      return;
    }
    const token = await validateDidoxCredentials(effectiveTin, effectivePassword, res);
    if (!token) return;
  }

  const patch: Partial<AccountSettings> = {
    autoSendDemand: Boolean(autoSendDemand),
  };
  if (didoxTin) patch.didoxTin = didoxTin;
  if (didoxPassword) patch.didoxPassword = didoxPassword;

  await installationStore.updateSettings(accountId, patch);
  res.json({ ok: true });
}
