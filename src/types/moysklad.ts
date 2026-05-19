/**
 * Minimal type definitions for the MoySklad JSON API 1.2 entities we touch.
 *
 * The real API has many more fields; we only model what the importer reads
 * or writes. Properties not declared here are still allowed to exist on the
 * wire — `unknown extras` is the spirit of these types.
 */

/** Standard MoySklad meta block (canonical "pointer" to any entity). */
export interface Meta {
  href: string;
  metadataHref?: string;
  type: string;          // 'product' | 'counterparty' | 'supply' | 'productfolder' | 'attributemetadata' | ...
  mediaType: string;     // usually 'application/json'
  uuidHref?: string;
}

export interface MetaRef {
  meta: Meta;
}

/** Standard list envelope returned by /entity/{type} */
export interface ListResponse<T> {
  context?: Record<string, unknown>;
  meta: {
    href: string;
    type: string;
    mediaType: string;
    size: number;
    limit: number;
    offset: number;
    nextHref?: string;
    previousHref?: string;
  };
  rows: T[];
}

/** A custom-attribute value as it appears on an entity. */
export interface AttributeValue {
  meta: Meta;
  id?: string;
  name?: string;
  type?: AttributeType;
  value: string | number | boolean | MetaRef | null;
}

export type AttributeType =
  | 'string' | 'long' | 'double' | 'boolean' | 'time' | 'file' | 'text'
  | 'link' | 'counterparty' | 'product' | 'organization' | 'employee'
  | 'contract' | 'store' | 'customentity';

/** Custom-attribute metadata definition (what /metadata/attributes returns + creates). */
export interface AttributeMeta {
  meta: Meta;
  id: string;
  name: string;
  type: AttributeType;
  required?: boolean;
}

export interface ProductFolder {
  meta: Meta;
  id: string;
  name: string;
  pathName?: string;
  productFolder?: MetaRef;
}

export interface Organization {
  meta: Meta;
  id: string;
  name: string;
}

export interface Store {
  meta: Meta;
  id: string;
  name: string;
}

export interface Counterparty {
  meta: Meta;
  id: string;
  name: string;
  companyType?: 'legal' | 'entrepreneur' | 'individual' | 'legalUZ' | 'entrepreneurUZ';
  inn?: string;
  /** Uzbekistan-specific extension block. Field name uses double-underscore. */
  mod__requisites__uz?: {
    inn?: string;
    oked?: string;
    vatPayerRegCode?: string;
    pinfl?: string;
  };
  attributes?: AttributeValue[];
}

export interface Product {
  meta: Meta;
  id: string;
  name: string;
  productFolder?: MetaRef;
  /** Uzbekistan-specific tasnif (IKPU/packaging) extension. */
  mod__tasnif__uz?: {
    ikpu?: string;
    packCode?: string;
    packName?: string;
  };
  attributes?: AttributeValue[];
}

export interface Supply {
  meta: Meta;
  id: string;
  name?: string;
  moment?: string;
  applicable?: boolean;
  vatEnabled?: boolean;
  vatIncluded?: boolean;
  organization?: MetaRef;
  agent?: MetaRef;
  store?: MetaRef;
  positions?: { meta: Meta } | SupplyPosition[];
  attributes?: AttributeValue[];
}

export interface SupplyPosition {
  assortment: MetaRef;
  quantity: number;
  /** MoySklad expects price in the smallest currency unit (kopeks / tiyins). */
  price: number;
  vat?: number;
  discount?: number;
}
