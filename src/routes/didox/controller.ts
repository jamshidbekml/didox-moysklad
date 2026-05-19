import { Request, Response } from 'express';
import { didoxApi, DidoxApiError } from '../../services/didox';
import { logger } from '../../utils/logger';
import { resolveDidoxSession } from './session';
import { renderDocumentsList } from './templates/list';
import { renderDocumentView } from './templates/view';

/**
 * GET /settings/documents
 * Iframe page that shows the user's Didox documents list.
 */
export function getDocumentsList(req: Request, res: Response): void {
  const contextKey = String(req.query.contextKey ?? '');
  const userLocale = String(req.query.userLocale ?? 'ru_RU');

  if (!contextKey) {
    res.status(400).send('Missing contextKey');
    return;
  }

  res.type('html').send(renderDocumentsList({ contextKey, userLocale }));
}

/**
 * GET /settings/documents/view?contextKey=&userLocale=&docId=
 * Iframe page that renders all fields of a single Didox document.
 */
export function getDocumentView(req: Request, res: Response): void {
  const contextKey = String(req.query.contextKey ?? '');
  const userLocale = String(req.query.userLocale ?? 'ru_RU');
  const docId = String(req.query.docId ?? '');

  if (!contextKey) {
    res.status(400).send('Missing contextKey');
    return;
  }
  if (!docId) {
    res.status(400).send('Missing docId');
    return;
  }

  res.type('html').send(renderDocumentView({ contextKey, userLocale, docId }));
}

/**
 * GET /settings/documents/list?contextKey=&owner=&page=&limit=
 * Fetches a page of Didox documents for the resolved account.
 */
export async function getDocumentsJson(req: Request, res: Response): Promise<void> {
  const session = await resolveDidoxSession(String(req.query.contextKey ?? ''), res);
  if (!session) return;

  const owner = req.query.owner === '0' ? 0 : 1;
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));

  try {
    const data = await didoxApi.listDocuments(session.userToken, { owner, page, limit });
    res.json(data);
  } catch (err) {
    const status = err instanceof DidoxApiError ? err.status || 502 : 502;
    logger.error({ err, accountId: session.accountId }, 'Didox listDocuments failed');
    res.status(502).json({ error: 'didox_upstream_error', upstreamStatus: status });
  }
}

/**
 * GET /settings/documents/details?contextKey=&docId=
 * Returns the full detail for a single Didox document.
 */
export async function getDocumentDetails(req: Request, res: Response): Promise<void> {
  const docId = String(req.query.docId ?? '');
  if (!docId) {
    res.status(400).json({ error: 'missing_doc_id' });
    return;
  }

  const session = await resolveDidoxSession(String(req.query.contextKey ?? ''), res);
  if (!session) return;

  try {
    const detail = await didoxApi.getDocument(session.userToken, docId);
    res.json(detail);
  } catch (err) {
    const status = err instanceof DidoxApiError ? err.status || 502 : 502;
    logger.error({ err, accountId: session.accountId, docId }, 'Didox getDocument failed');
    res.status(502).json({ error: 'didox_upstream_error', upstreamStatus: status });
  }
}
