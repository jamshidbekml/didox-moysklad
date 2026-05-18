/**
 * Type definitions for the Didox Partner API.
 * Base URL: https://api-partners.didox.uz/
 */

// ---- Auth ------------------------------------------------------------------

export type DidoxLocale = 'ru' | 'uz' | 'en';

export interface DidoxAuthRequest {
  /** СТИР / ЖШШИР of the company or individual (9 or 14 digits). */
  inn: string;
  password: string;
  locale?: DidoxLocale;
}

export interface DidoxAuthResponse {
  token: string;
  related_companies: unknown | null;
}

// ---- Documents -------------------------------------------------------------

/** Outgoing vs incoming filter. 1 = outgoing (default), 0 = incoming. */
export type DidoxOwner = 0 | 1;
/** Boolean-as-int filter. */
export type DidoxBoolInt = 0 | 1;

export interface DidoxListDocumentsParams {
  /** 1 = outgoing (default if omitted), 0 = incoming. */
  owner?: DidoxOwner;
  /** Page number, 1-based. */
  page: number;
  /** 1-100. */
  limit: number;
  /** yyyy-mm-dd */
  dateFromCreated?: string;
  dateToCreated?: string;
  dateFromUpdated?: string;
  dateToUpdated?: string;
  /** Sign date on Didox (yyyy-mm-dd). */
  signDateFrom?: string;
  signDateTo?: string;
  /** Document type code (e.g. "002"). */
  doctype?: string;
  /** Document number. */
  name?: string;
  sum?: number;
  docDateFromCreated?: string;
  docDateToCreated?: string;
  contractName?: string;
  contractDate?: string;
  hasCommittent?: DidoxBoolInt;
  hasLgota?: DidoxBoolInt;
  hasMarks?: DidoxBoolInt;
  oneside?: DidoxBoolInt;
  /** Partner TIN (e.g. "303186914"). */
  partner?: string;
  /**
   * Status filter. Comma-separated string per the API ("0,2"), or array of
   * codes. Omit to receive the default set (SIGNED_SELF, SIGNED_PARTY,
   * SIGNED, REJECTED, WAIT_FOR_AGENT_SIGN, SIGNED_BY_AGENT, NOT_VALID).
   */
  status?: string | number[];
}

/**
 * Document statuses Didox returns when no status filter is supplied.
 * Numeric codes are not documented in the spec excerpt; treat doc_status as a
 * number and map externally if you need symbolic names.
 */
export type DidoxDocumentStatusName =
  | 'STATUS_SIGNAED_SELF'
  | 'STATUS_SIGNED_PARTY'
  | 'STATUS_SIGNED'
  | 'STATUS_REJECTED'
  | 'STATUS_WAIT_FOR_AGENT_SIGN'
  | 'STATUS_SIGNED_BY_AGENT'
  | 'STATUS_NOT_VALID';

export interface DidoxDocument {
  pid: number;
  doc_id: string;
  usersTaxId: string;
  name: string;
  doc_date: string;
  doc_status: number;
  doctype: string;
  contract_number: string | null;
  contract_date: string | null;
  owner: DidoxOwner;
  agent: number;
  partnerTin: string;
  partnerAllowProposals: number;
  partnerCompany: string;
  partnerPhone: string | null;
  total_sum: number;
  total_delivery_sum: number;
  total_vat_sum: number;
  total_delivery_sum_with_vat: number;
  oneside: DidoxBoolInt;
  has_committent: DidoxBoolInt;
  has_vat: boolean;
  has_lgota: DidoxBoolInt;
  has_marks: DidoxBoolInt;
  roaming_id: string | null;
  signed: string | null;
  updated: string;
  updated_date: string;
  updated_unix: number;
  created: string;
  created_unix: number;
  partiesID: string | null;
  lgota_codes: string | null;
  factura_type: number;
  sellerAccount: string | null;
  status_comment: string | null;
  internal_status: string | null;
  internal_comment: string | null;
  internal_status_alarm: string | null;
  mark_codes: string | null;
  branch_num: string | null;
  scoring: unknown | null;
}

export interface DidoxDocumentsPage {
  data: DidoxDocument[];
  total: number;
  next_page_url: string | null;
  source: string;
}

// ---- Errors ----------------------------------------------------------------

/**
 * Shape of the 422 body when Didox returns field-level validation errors,
 * e.g. wrong password: { taxId: ["validation.exists"] }
 */
export type DidoxValidationErrorBody = Record<string, string[]>;
