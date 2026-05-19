import { Router } from 'express';
import {
  getDocumentDetails,
  getDocumentsJson,
  getDocumentsList,
  getDocumentView,
} from './controller';

/**
 * Didox documents router.
 * Mount path: /settings/documents (kept under /settings so existing iframe
 * URLs and the MoySklad iframe back-link continue to work).
 */
export const didoxRouter = Router();

didoxRouter.get('/', getDocumentsList);          // /settings/documents
didoxRouter.get('/view', getDocumentView);       // /settings/documents/view
didoxRouter.get('/list', getDocumentsJson);      // /settings/documents/list
didoxRouter.get('/details', getDocumentDetails); // /settings/documents/details
