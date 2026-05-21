import { didoxApi } from '../services/didox';
import { withDidoxToken } from '../services/didox-auth';
import { MoyskladEntities } from '../services/moysklad-entities';
import { AccountMetadata, ensureAccountMetadata } from '../services/moysklad-metadata';
import { installationStore } from '../services/store';
import { AttributeMeta, Counterparty, MetaRef, Organization, Product } from '../types/moysklad';
import { DidoxDocument, DidoxDocumentDetail, DidoxProduct } from '../types/didox';
import { logger } from '../utils/logger';

export interface ImportSummary {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  errors: Array<{ docId: string; error: string }>;
}

/**
 * Entry point invoked by the async job runner.
 *
 * 1. Load installation (access token + Didox credentials)
 * 2. Mint a Didox user-token
 * 3. List the user's incoming Didox documents (owner=0)
 * 4. Ensure MoySklad custom attributes + product folder exist
 * 5. For each document, run the per-doc importer
 */
export async function runImport(accountId: string): Promise<ImportSummary> {
  const install = await installationStore.get(accountId);
  if (!install?.accessToken) {
    throw new Error('installation_missing_access_token');
  }
  if (!install.settings?.didoxTin || !install.settings.didoxPassword) {
    throw new Error('didox_credentials_not_configured');
  }

  const entities = new MoyskladEntities(install.accessToken);
  const metadata = await ensureAccountMetadata(accountId, entities);
  const organization = await pickFirstOrg(entities);

  const summary: ImportSummary = {
    total: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // Wrap the Didox-facing portion so a 401 from a stale cached token
  // triggers one automatic refresh + restart. The per-doc duplicate check
  // (findInvoiceInByDidoxInvoiceId) makes a restart idempotent.
  await withDidoxToken(accountId, async (didoxToken) => {
    // For MVP we fetch one page of incoming docs. Pagination is a follow-up.
    const page = await didoxApi.listDocuments(didoxToken, { owner: 0, page: 1, limit: 50 });
    summary.total = page.data.length;
    summary.imported = 0;
    summary.skipped = 0;
    summary.failed = 0;
    summary.errors = [];

    for (const doc of page.data) {
      try {
        const outcome = await importOne(doc, didoxToken, entities, metadata, organization);
        if (outcome === 'imported') summary.imported++;
        else if (outcome === 'skipped') summary.skipped++;
      } catch (err) {
        summary.failed++;
        const message = err instanceof Error ? err.message : String(err);
        summary.errors.push({ docId: doc.doc_id, error: message });
        logger.error({ err, accountId, docId: doc.doc_id }, 'Failed to import Didox document');
      }
    }
  });

  logger.info(
    { accountId, ...summary, errors: summary.errors.length },
    'Didox import finished'
  );
  return summary;
}

async function importOne(
  doc: DidoxDocument,
  didoxToken: string,
  entities: MoyskladEntities,
  metadata: AccountMetadata,
  organization: Organization
): Promise<'imported' | 'skipped'> {
  // Idempotency: skip if an InvoiceIn already carries this docId on its
  // didoxInvoiceId attribute.
  const dup = await entities.findInvoiceInByDidoxInvoiceId(
    metadata.attrs.invoiceInDidoxInvoiceId.id,
    doc.doc_id
  );
  if (dup) {
    logger.info({ docId: doc.doc_id, invoiceInId: dup.id }, 'Didox doc already imported');
    return 'skipped';
  }

  const detail = await didoxApi.getDocument(didoxToken, doc.doc_id);

  const supplier = await resolveSupplier(detail, entities, metadata);
  const positions = await resolvePositions(detail, entities, metadata);

  await entities.createInvoiceIn({
    organization: { meta: organization.meta },
    agent: { meta: supplier.meta },
    moment: detail.document.created || new Date().toISOString(),
    incomingNumber: detail.json.facturadoc?.facturano || doc.name,
    incomingDate: toMoyskladDate(detail.json.facturadoc?.facturadate || doc.doc_date),
    vatEnabled: true,
    vatIncluded: true,
    positions,
    attributes: [
      attrValue(metadata.attrs.invoiceInDidoxInvoiceId, doc.doc_id),
      attrValue(metadata.attrs.invoiceInDidoxStatus, 'draft'),
    ],
  } as Parameters<typeof entities.createInvoiceIn>[0]);

  return 'imported';
}

/**
 * Find an existing counterparty by the seller's INN, or create a draft one
 * marked as "unverified" so the user can complete its details later.
 */
async function resolveSupplier(
  detail: DidoxDocumentDetail,
  entities: MoyskladEntities,
  metadata: AccountMetadata
): Promise<Counterparty> {
  const sellerInn = detail.json.sellertin;
  const seller = detail.json.seller;

  if (!sellerInn) {
    throw new Error('didox_seller_missing_inn');
  }

  const existing = await entities.findCounterpartyByInn(sellerInn);
  if (existing) return existing;

  return entities.createCounterparty({
    name: seller?.name || `Didox supplier ${sellerInn}`,
    companyType: 'legalUZ',
    mod__requisites__uz: {
      inn: sellerInn,
      oked: seller?.oked || undefined,
      vatPayerRegCode: seller?.vatregcode || undefined,
    },
    attributes: [attrValue(metadata.attrs.counterpartyDidoxUnverified, true)],
  });
}

/**
 * Resolve each Didox product line to a MoySklad product. Returns the
 * `positions` array ready to inline into the Supply payload.
 */
async function resolvePositions(
  detail: DidoxDocumentDetail,
  entities: MoyskladEntities,
  metadata: AccountMetadata
) {
  const products = detail.json.productlist?.products ?? [];
  const positions = [];
  for (const line of products) {
    const product = await resolveProduct(line, entities, metadata);
    positions.push({
      assortment: { meta: product.meta },
      quantity: Number(line.count) || 1,
      // MoySklad expects price in the smallest currency unit (tiyin = 1/100 sum).
      price: toMinorUnits(line.summa),
      vat: line.vatrate || 0,
      discount: 0,
    });
  }
  return positions;
}

async function resolveProduct(
  line: DidoxProduct,
  entities: MoyskladEntities,
  metadata: AccountMetadata
): Promise<Product> {
  if (line.catalogcode) {
    const byIkpu = await entities.findProductByIkpu(line.catalogcode);
    if (byIkpu) return byIkpu;
  }
  if (line.name) {
    const byName = await entities.findProductByName(line.name);
    if (byName) return byName;
  }

  return entities.createProduct({
    name: line.name || line.catalogname || 'Didox import',
    productFolder: { meta: metadata.productFolder.meta },
    mod__tasnif__uz: {
      ikpu: line.catalogcode || undefined,
      packCode: line.packagecode != null ? String(line.packagecode) : undefined,
      packName: line.packagename || undefined,
    },
    attributes: [
      attrValue(metadata.attrs.productDidoxImported, true),
      ...(line.catalogcode ? [attrValue(metadata.attrs.productDidoxIkpu, line.catalogcode)] : []),
    ],
  });
}

async function pickFirstOrg(entities: MoyskladEntities): Promise<Organization> {
  const orgs = await entities.listOrganizations();
  if (!orgs[0]) throw new Error('moysklad_no_organization');
  return orgs[0];
}

/** Build an AttributeValue payload referencing a known custom attribute. */
function attrValue(
  attr: AttributeMeta,
  value: string | number | boolean | MetaRef
): { meta: typeof attr.meta; value: typeof value } {
  return { meta: attr.meta, value };
}

/** Convert a Didox decimal string (e.g. "1.12") to MoySklad minor units (tiyin). */
function toMinorUnits(decimal: string | number | null | undefined): number {
  const n = typeof decimal === 'string' ? parseFloat(decimal) : Number(decimal ?? 0);
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
}

/**
 * MoySklad expects datetime as "yyyy-MM-dd HH:mm:ss.SSS". Didox `facturadate`
 * usually comes in as "yyyy-MM-dd" (no time component). Append midnight when
 * the input lacks a time so MoySklad accepts it.
 */
function toMoyskladDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} 00:00:00.000`;
  return s;
}
