import axios, { AxiosError, AxiosInstance } from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import {
  AttributeMeta,
  AttributeType,
  Counterparty,
  InvoiceIn,
  ListResponse,
  Organization,
  Product,
  ProductFolder,
  Store,
  Supply,
} from '../types/moysklad';

export class MoyskladApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'MoyskladApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Per-account typed wrapper around MoySklad JSON API 1.2.
 *
 * Construct with the access_token MoySklad granted to us during activation
 * (stored encrypted in our installation record).
 *
 * Only the methods the Didox importer needs are implemented — extend as the
 * feature set grows. All list responses follow the same { meta, rows } shape.
 */
export class MoyskladEntities {
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

  // ---- Organizations / stores --------------------------------------------

  async listOrganizations(): Promise<Organization[]> {
    const data = await this.get<ListResponse<Organization>>('/entity/organization', { limit: 100 });
    return data.rows;
  }

  async listStores(): Promise<Store[]> {
    const data = await this.get<ListResponse<Store>>('/entity/store', { limit: 100 });
    return data.rows;
  }

  // ---- Counterparties ----------------------------------------------------

  /**
   * Look up a counterparty by Uzbekistan ИНН via the tasnif/requisites extension.
   * Returns the first match or null.
   */
  async findCounterpartyByInn(inn: string): Promise<Counterparty | null> {
    const data = await this.get<ListResponse<Counterparty>>('/entity/counterparty', {
      filter: `mod__requisites__uz.inn=${inn}`,
      limit: 1,
    });
    return data.rows[0] ?? null;
  }

  async createCounterparty(payload: Partial<Counterparty>): Promise<Counterparty> {
    return this.post<Counterparty>('/entity/counterparty', payload);
  }

  // ---- Products / product folders ----------------------------------------

  async findProductByIkpu(ikpu: string): Promise<Product | null> {
    const data = await this.get<ListResponse<Product>>('/entity/product', {
      filter: `mod__tasnif__uz.ikpu=${ikpu}`,
      limit: 1,
    });
    return data.rows[0] ?? null;
  }

  async findProductByName(name: string): Promise<Product | null> {
    const data = await this.get<ListResponse<Product>>('/entity/product', {
      filter: `name=${name}`,
      limit: 1,
    });
    return data.rows[0] ?? null;
  }

  async createProduct(payload: Partial<Product>): Promise<Product> {
    return this.post<Product>('/entity/product', payload);
  }

  async findProductFolderByName(name: string): Promise<ProductFolder | null> {
    const data = await this.get<ListResponse<ProductFolder>>('/entity/productfolder', {
      filter: `name=${name}`,
      limit: 1,
    });
    return data.rows[0] ?? null;
  }

  async createProductFolder(payload: Partial<ProductFolder>): Promise<ProductFolder> {
    return this.post<ProductFolder>('/entity/productfolder', payload);
  }

  // ---- Supply (Приёмка) --------------------------------------------------

  async createSupply(payload: Partial<Supply>): Promise<Supply> {
    return this.post<Supply>('/entity/supply', payload);
  }

  // ---- InvoiceIn (Счёт поставщика) ---------------------------------------

  /**
   * Check whether an InvoiceIn already carries the given Didox invoice id on
   * its custom-attribute `didoxInvoiceId`. Used for idempotency on the
   * Didox → MoySklad import path (flow.md §5.4).
   *
   * `attrMetaId` is the UUID of the attribute definition (from /metadata).
   */
  async findInvoiceInByDidoxInvoiceId(attrMetaId: string, didoxInvoiceId: string): Promise<InvoiceIn | null> {
    const data = await this.get<ListResponse<InvoiceIn>>('/entity/invoicein', {
      filter: `${attrMetaId}=${didoxInvoiceId}`,
      limit: 1,
    });
    return data.rows[0] ?? null;
  }

  async createInvoiceIn(payload: Partial<InvoiceIn>): Promise<InvoiceIn> {
    return this.post<InvoiceIn>('/entity/invoicein', payload);
  }

  // ---- Custom attribute metadata -----------------------------------------

  /**
   * List the custom-attribute definitions for the given entity type.
   * E.g. listAttributeMetadata('product') returns all custom attributes
   * defined on products for this account.
   */
  async listAttributeMetadata(
    entityType: 'product' | 'counterparty' | 'supply' | 'invoicein'
  ): Promise<AttributeMeta[]> {
    const data = await this.get<ListResponse<AttributeMeta>>(
      `/entity/${entityType}/metadata/attributes`
    );
    return data.rows;
  }

  /** Create a custom attribute definition on the given entity type. */
  async createAttributeMetadata(
    entityType: 'product' | 'counterparty' | 'supply' | 'invoicein',
    name: string,
    type: AttributeType
  ): Promise<AttributeMeta> {
    return this.post<AttributeMeta>(`/entity/${entityType}/metadata/attributes`, { name, type });
  }

  // ---- Internal HTTP helpers ---------------------------------------------

  private async get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
    try {
      const res = await this.http.get<T>(url, { params });
      return res.data;
    } catch (err) {
      throw this.wrap(err, 'GET', url);
    }
  }

  private async post<T>(url: string, body: unknown): Promise<T> {
    try {
      const res = await this.http.post<T>(url, body);
      return res.data;
    } catch (err) {
      throw this.wrap(err, 'POST', url);
    }
  }

  private wrap(err: unknown, method: string, url: string): MoyskladApiError {
    const ax = err as AxiosError;
    const status = ax.response?.status ?? 0;
    const body = ax.response?.data;
    logger.error({ err, status, method, url }, 'MoySklad JSON API call failed');
    return new MoyskladApiError(`MoySklad ${method} ${url} failed (HTTP ${status})`, status, body);
  }
}
