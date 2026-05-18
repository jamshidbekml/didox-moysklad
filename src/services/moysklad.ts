import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { signOutgoingJwt } from './jwt';
import { logger } from '../utils/logger';
import { ActivationStatus } from '../types/vendor';

/**
 * Client for calling MoySklad Vendor API (apps-api.moysklad.ru).
 * All requests are signed with a fresh one-time JWT per the spec.
 */
class VendorApiClient {
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: config.moysklad.vendorApiBase,
      timeout: 15_000,
      headers: {
        'Accept-Encoding': 'gzip',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    this.http.interceptors.request.use((req) => {
      req.headers.Authorization = `Bearer ${signOutgoingJwt()}`;
      return req;
    });
  }

  /**
   * PUT /apps/{appId}/{accountId}/status
   * Used to transition us → MoySklad when activation was Activating or SettingsRequired.
   */
  async updateStatus(
    accountId: string,
    status: ActivationStatus
  ): Promise<void> {
    const url = `/apps/${config.moysklad.appId}/${accountId}/status`;
    try {
      await this.http.put(url, { status });
      logger.info({ accountId, status }, 'Vendor API: status updated');
    } catch (err) {
      logger.error(
        { err, accountId, status, url },
        'Vendor API: failed to update status'
      );
      throw err;
    }
  }

  /**
   * GET /apps/{appId}/{accountId}/status
   */
  async getStatus(accountId: string): Promise<unknown> {
    const url = `/apps/${config.moysklad.appId}/${accountId}/status`;
    const res = await this.http.get(url);
    return res.data;
  }

  /**
   * POST /context/{contextKey}
   * Resolves the contextKey received in iframe load to the current user's info.
   */
  async getUserContext(contextKey: string): Promise<unknown> {
    const url = `/context/${contextKey}`;
    const res = await this.http.post(url);
    return res.data;
  }
}

/**
 * Client for calling JSON API 1.2 with the per-account access_token granted
 * during activation. Build a new client per request — tokens are per-account.
 */
export class JsonApiClient {
  private readonly http: AxiosInstance;

  constructor(accessToken: string) {
    this.http = axios.create({
      baseURL: config.moysklad.jsonApiBase,
      timeout: 30_000,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Accept-Encoding': 'gzip',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
  }

  async getCurrentEmployee(): Promise<unknown> {
    const res = await this.http.get('/context/employee');
    return res.data;
  }

  // Add more JSON API helpers as you need them (organization, counterparty, demand, etc.)
}

export const vendorApi = new VendorApiClient();
