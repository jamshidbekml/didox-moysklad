import axios, { AxiosError, AxiosInstance } from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import {
  DidoxAuthRequest,
  DidoxAuthResponse,
  DidoxDocumentDetail,
  DidoxDocumentDetailResponse,
  DidoxDocumentsPage,
  DidoxListDocumentsParams,
  DidoxValidationErrorBody,
} from '../types/didox';

/**
 * Errors thrown by DidoxClient. Callers can branch on instanceof to map
 * specific business outcomes to HTTP responses (e.g. wrong password → 401).
 */
export class DidoxApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'DidoxApiError';
    this.status = status;
    this.body = body;
  }
}

/** 422, body literal "User not registered". */
export class DidoxUserNotRegisteredError extends DidoxApiError {
  constructor(body: unknown) {
    super('Didox: user not registered', 422, body);
    this.name = 'DidoxUserNotRegisteredError';
  }
}

/** 422, body { taxId: ["validation.exists"] } — wrong password for the given TIN. */
export class DidoxInvalidCredentialsError extends DidoxApiError {
  constructor(body: unknown) {
    super('Didox: invalid credentials', 422, body);
    this.name = 'DidoxInvalidCredentialsError';
  }
}

function isValidationErrorBody(body: unknown): body is DidoxValidationErrorBody {
  if (!body || typeof body !== 'object') return false;
  return Object.values(body as Record<string, unknown>).every(
    (v) => Array.isArray(v) && v.every((x) => typeof x === 'string')
  );
}

/**
 * Client for the Didox Partner API (https://api-partners.didox.uz/).
 *
 * The `Partner-Authorization` header is set once at construction from
 * config.didox.partnerToken. The per-user `user-key` header is attached
 * by the methods that need it.
 */
class DidoxClient {
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: config.didox.baseUrl,
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Partner-Authorization': config.didox.partnerToken,
      },
    });
  }

  /**
   * POST /v1/auth/{inn}/password/{locale}
   * Body: { password }
   * Returns { token, related_companies }.
   *
   * Throws DidoxUserNotRegisteredError or DidoxInvalidCredentialsError on 422.
   */
  async getToken({ inn, password, locale = 'ru' }: DidoxAuthRequest): Promise<DidoxAuthResponse> {
    const url = `/v1/auth/${encodeURIComponent(inn)}/password/${encodeURIComponent(locale)}`;
    try {
      const res = await this.http.post<DidoxAuthResponse>(url, { password });
      return res.data;
    } catch (err) {
      const ax = err as AxiosError;
      const status = ax.response?.status ?? 0;
      const body = ax.response?.data;

      if (status === 422) {
        if (typeof body === 'string' && body.trim() === 'User not registered') {
          throw new DidoxUserNotRegisteredError(body);
        }
        if (isValidationErrorBody(body)) {
          // Wrong password is signalled by { taxId: ["validation.exists"] }
          throw new DidoxInvalidCredentialsError(body);
        }
      }

      logger.error({ err, status, url }, 'Didox: getToken failed');
      throw new DidoxApiError(`Didox auth failed (HTTP ${status})`, status, body);
    }
  }

  /**
   * GET /v2/documents
   * Requires the per-user token in the `user-key` header. Returns a page of
   * documents matching the provided filters.
   */
  async listDocuments(
    userToken: string,
    params: DidoxListDocumentsParams
  ): Promise<DidoxDocumentsPage> {
    try {
      const res = await this.http.get<DidoxDocumentsPage>('/v2/documents', {
        params: serializeListParams(params),
        headers: { 'user-key': userToken },
      });
      return res.data;
    } catch (err) {
      const ax = err as AxiosError;
      const status = ax.response?.status ?? 0;
      const body = ax.response?.data;
      logger.error({ err, status }, 'Didox: listDocuments failed');
      throw new DidoxApiError(`Didox listDocuments failed (HTTP ${status})`, status, body);
    }
  }

  /**
   * GET /v1/documents/{id}
   * Returns full detail (factura JSON, party info, products, signatures, etc.)
   * Unwraps the `{ data: ... }` envelope and returns the inner detail object.
   */
  async getDocument(userToken: string, docId: string): Promise<DidoxDocumentDetail> {
    const url = `/v1/documents/${encodeURIComponent(docId)}`;
    try {
      const res = await this.http.get<DidoxDocumentDetailResponse>(url, {
        headers: { 'user-key': userToken },
      });
      return res.data.data;
    } catch (err) {
      const ax = err as AxiosError;
      const status = ax.response?.status ?? 0;
      const body = ax.response?.data;
      logger.error({ err, status, docId }, 'Didox: getDocument failed');
      throw new DidoxApiError(`Didox getDocument failed (HTTP ${status})`, status, body);
    }
  }
}

function serializeListParams(p: DidoxListDocumentsParams): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(p)) {
    if (value === undefined || value === null) continue;
    if (key === 'status' && Array.isArray(value)) {
      out[key] = value.join(',');
      continue;
    }
    out[key] = value as string | number;
  }
  return out;
}

export const didoxApi = new DidoxClient();
