/**
 * Type definitions for MoySklad Vendor API 1.0
 * Reference: https://dev.moysklad.ru/doc/api/vendor/1.0/
 */

export type ActivationCause =
  | 'Install'
  | 'Resume'
  | 'TariffChanged'
  | 'Autoprolongation';

export type DeactivationCause = 'Uninstall' | 'Suspend';

export type ActivationStatus = 'Activating' | 'SettingsRequired' | 'Activated';

export interface AccessPermissions {
  [key: string]: unknown;
}

export interface AccessGrant {
  resource: string;
  scope: ('admin' | 'custom')[];
  permissions?: AccessPermissions;
  access_token?: string;
}

export interface Subscription {
  tariffId: string;
  trial: boolean;
  tariffName?: string;
  expiryMoment?: string;
  notForResale: boolean;
  partner: boolean;
}

export interface AdditionalParams {
  fiscalApi?: {
    id: string;
    token: string;
  };
}

export interface ActivationRequest {
  appUid: string;
  accountName: string;
  cause: ActivationCause;
  access?: AccessGrant[];
  subscription?: Subscription;
  additional?: AdditionalParams;
}

export interface ActivationResponse {
  status: ActivationStatus;
}

export interface DeactivationRequest {
  appUid?: string;
  accountName?: string;
  cause: DeactivationCause;
}

/**
 * Account state stored on our side.
 * Represents the installation of our solution on a particular MoySklad account.
 */
export interface AccountInstallation {
  accountId: string;
  appUid: string;
  accountName: string;
  status: ActivationStatus | 'Deactivated';
  accessToken?: string;
  subscription?: Subscription;
  settings?: AccountSettings;
  installedAt: string;
  updatedAt: string;
}

/**
 * Per-account settings configured by the admin through the main iframe.
 * For Didox MVP, these are placeholders. Extend as needed.
 */
export interface AccountSettings {
  didoxTin?: string; // СТИР (9 digits, legal entity) / ЖШШИР (14 digits, individual)
  didoxPassword?: string; // plaintext password — decrypted in memory only, encrypted at rest
  autoSendDemand?: boolean;
  configured?: boolean;
}
