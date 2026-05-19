import { AttributeMeta, AttributeType, ProductFolder } from '../types/moysklad';
import { logger } from '../utils/logger';
import { MoyskladEntities } from './moysklad-entities';

/**
 * Custom attribute and folder definitions the importer needs to exist on
 * each MoySklad account it imports into. See flow.md, Step 0.
 */
export interface AccountMetadata {
  productFolder: ProductFolder;
  attrs: {
    productDidoxImported: AttributeMeta;
    productDidoxIkpu: AttributeMeta;
    counterpartyDidoxUnverified: AttributeMeta;
    supplyDidoxInvoiceId: AttributeMeta;
    supplyDidoxStatus: AttributeMeta;
    supplyDidoxError: AttributeMeta;
  };
}

const FOLDER_NAME = 'Didox imports';

const SPEC = {
  product: [
    { key: 'productDidoxImported', name: 'didoxImported', type: 'boolean' as AttributeType },
    { key: 'productDidoxIkpu',     name: 'didoxIkpu',     type: 'string'  as AttributeType },
  ],
  counterparty: [
    { key: 'counterpartyDidoxUnverified', name: 'didoxUnverified', type: 'boolean' as AttributeType },
  ],
  supply: [
    { key: 'supplyDidoxInvoiceId', name: 'didoxInvoiceId', type: 'string' as AttributeType },
    { key: 'supplyDidoxStatus',    name: 'didoxStatus',    type: 'string' as AttributeType },
    { key: 'supplyDidoxError',     name: 'didoxError',     type: 'string' as AttributeType },
  ],
} as const;

/**
 * In-memory cache: accountId → resolved metadata.
 *
 * MoySklad metadata never changes once created on an account, so it's safe to
 * cache for the lifetime of the process. A process restart re-resolves via
 * find-or-create (idempotent — no duplicates).
 */
const cache = new Map<string, AccountMetadata>();

/**
 * Ensure the "Didox imports" folder and all custom attributes exist on the
 * given account, returning their meta blocks ready for use in entity payloads.
 *
 * Idempotent — repeated calls find existing definitions instead of creating
 * duplicates.
 */
export async function ensureAccountMetadata(
  accountId: string,
  entities: MoyskladEntities
): Promise<AccountMetadata> {
  const cached = cache.get(accountId);
  if (cached) return cached;

  logger.info({ accountId }, 'Resolving MoySklad metadata');

  const productFolder = await ensureProductFolder(entities);
  const productAttrs = await ensureAttributes(entities, 'product', SPEC.product);
  const counterpartyAttrs = await ensureAttributes(entities, 'counterparty', SPEC.counterparty);
  const supplyAttrs = await ensureAttributes(entities, 'supply', SPEC.supply);

  const resolved: AccountMetadata = {
    productFolder,
    attrs: {
      productDidoxImported:        productAttrs.productDidoxImported,
      productDidoxIkpu:            productAttrs.productDidoxIkpu,
      counterpartyDidoxUnverified: counterpartyAttrs.counterpartyDidoxUnverified,
      supplyDidoxInvoiceId:        supplyAttrs.supplyDidoxInvoiceId,
      supplyDidoxStatus:           supplyAttrs.supplyDidoxStatus,
      supplyDidoxError:            supplyAttrs.supplyDidoxError,
    },
  };

  cache.set(accountId, resolved);
  logger.info({ accountId, folderId: productFolder.id }, 'MoySklad metadata ready');
  return resolved;
}

/** Clear the cache for one account — call on uninstall. */
export function invalidateAccountMetadata(accountId: string): void {
  cache.delete(accountId);
}

async function ensureProductFolder(entities: MoyskladEntities): Promise<ProductFolder> {
  const existing = await entities.findProductFolderByName(FOLDER_NAME);
  if (existing) return existing;
  return entities.createProductFolder({ name: FOLDER_NAME });
}

async function ensureAttributes<K extends string>(
  entities: MoyskladEntities,
  entityType: 'product' | 'counterparty' | 'supply',
  spec: ReadonlyArray<{ key: K; name: string; type: AttributeType }>
): Promise<Record<K, AttributeMeta>> {
  const existing = await entities.listAttributeMetadata(entityType);
  const byName = new Map(existing.map((a) => [a.name, a]));

  const out = {} as Record<K, AttributeMeta>;
  for (const { key, name, type } of spec) {
    let attr = byName.get(name);
    if (!attr) {
      attr = await entities.createAttributeMetadata(entityType, name, type);
    }
    out[key] = attr;
  }
  return out;
}
