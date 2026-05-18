import { Router, Request, Response } from 'express';
import { captureRequestId, requireVendorJwt } from '../middleware/auth';
import { installationStore } from '../services/store';
import { logger } from '../utils/logger';
import {
  ActivationRequest,
  ActivationResponse,
  DeactivationRequest,
} from '../types/vendor';

export const vendorRouter = Router();

vendorRouter.use(captureRequestId);
vendorRouter.use(requireVendorJwt);

/**
 * Resource: PUT /api/moysklad/vendor/1.0/apps/{appId}/{accountId}
 * Called by MoySklad on Install, Resume, TariffChanged, Autoprolongation.
 *
 * Spec: https://dev.moysklad.ru/doc/api/vendor/1.0/#aktivaciq-resheniq-na-akkaunte
 *
 * Returns one of: Activating, SettingsRequired, Activated.
 *
 * Important error semantics:
 *   - 4xx response → MoySklad gives up and marks installation ActivationFailed
 *   - 5xx response → MoySklad retries per the Retry policy
 * So for transient internal errors, return 503 to get a retry. For real config
 * problems on our side, return 4xx so the install fails cleanly.
 *
 * Idempotency: MoySklad may retry the same request (same X_Lognex_RequestId).
 * We use upsert in the store, so repeats are safe.
 */
vendorRouter.put(
  '/apps/:appId/:accountId',
  async (req: Request, res: Response) => {
    const { accountId } = req.params;
    const body = req.body as ActivationRequest;

    logger.info(
      {
        accountId,
        appUid: body.appUid,
        accountName: body.accountName,
        cause: body.cause,
        trial: body.subscription?.trial,
        requestId: req.requestId,
      },
      'Activation request received'
    );

    // Find any access token granted to us
    const jsonApiAccess = body.access?.find((a) =>
      a.resource.includes('/api/remap/1.2')
    );
    const accessToken = jsonApiAccess?.access_token;

    // For TariffChanged / Autoprolongation, MoySklad does NOT send access_token
    // and we should not clear an existing one — see the spec.
    const preserveExistingToken =
      body.cause === 'TariffChanged' || body.cause === 'Autoprolongation';

    const existing = installationStore.get(accountId);
    const tokenToStore = preserveExistingToken
      ? accessToken ?? existing?.accessToken
      : accessToken;

    // Decide the initial status to return.
    // For MVP: every fresh Install requires settings from the admin.
    // For Resume of a previously-configured installation we go straight to Activated.
    let status: ActivationResponse['status'];
    if (body.cause === 'Install') {
      status = 'SettingsRequired';
    } else if (
      body.cause === 'Resume' ||
      body.cause === 'TariffChanged' ||
      body.cause === 'Autoprolongation'
    ) {
      // If we previously had it configured, jump straight back to Activated.
      status = existing?.settings?.configured ? 'Activated' : 'SettingsRequired';
    } else {
      status = 'SettingsRequired';
    }

    installationStore.upsert({
      accountId,
      appUid: body.appUid,
      accountName: body.accountName,
      status,
      accessToken: tokenToStore,
      subscription: body.subscription ?? existing?.subscription,
      settings: existing?.settings,
      installedAt: existing?.installedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const response: ActivationResponse = { status };
    res.status(200).json(response);
  }
);

/**
 * Resource: DELETE /api/moysklad/vendor/1.0/apps/{appId}/{accountId}
 * Called by MoySklad on Uninstall or Suspend.
 *
 * Spec: https://dev.moysklad.ru/doc/api/vendor/1.0/#deaktiwaciq-resheniq-na-akkaunte
 *
 * Token is already revoked on MoySklad side by the time this fires.
 *
 * Return 200 on successful deactivation, 204 if we have no record of the account.
 */
vendorRouter.delete(
  '/apps/:appId/:accountId',
  async (req: Request, res: Response) => {
    const { accountId } = req.params;
    const body = req.body as DeactivationRequest;

    logger.info(
      {
        accountId,
        cause: body.cause,
        appUid: body.appUid,
        accountName: body.accountName,
        requestId: req.requestId,
      },
      'Deactivation request received'
    );

    const existing = installationStore.get(accountId);
    if (!existing) {
      res.status(204).end();
      return;
    }

    installationStore.markDeactivated(accountId);
    res.status(200).end();
  }
);

/**
 * Optional: GET /api/moysklad/vendor/1.0/apps/{appId}/{accountId}
 * Status check endpoint. Not used by current MoySklad implementation but documented.
 */
vendorRouter.get(
  '/apps/:appId/:accountId',
  async (req: Request, res: Response) => {
    const { accountId } = req.params;
    const install = installationStore.get(accountId);

    if (!install || install.status === 'Deactivated') {
      res.status(404).end();
      return;
    }

    res.status(200).json({ status: install.status });
  }
);
