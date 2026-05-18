import express from 'express';
import cors from 'cors';
import { config } from './config';
import { logger } from './utils/logger';
import { vendorRouter } from './routes/vendor';
import { settingsRouter } from './routes/settings';
import { connectDatabase } from './services/db';

const app = express();

// Express's default JSON parser is fine; raise the limit slightly for safety.
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false }));

// The iframe is loaded from the MoySklad host into our domain. We don't need
// CORS for the iframe HTML itself (it's a top-level navigation inside the iframe),
// but the iframe's fetch() calls to /settings/* are same-origin to our server
// (our domain), so CORS isn't required there either. Enable it only as defense
// in depth for non-browser API consumers.
app.use(cors({ origin: false }));

// Request logging (one line per request)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info(
      {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - start,
      },
      'http'
    );
  });
  next();
});

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    appUid: config.moysklad.appUid,
    nodeEnv: config.nodeEnv,
  });
});

// MoySklad Vendor API endpoints
// Per the descriptor: endpointBase = ${PUBLIC_BASE_URL}
// MoySklad will call: ${PUBLIC_BASE_URL}/api/moysklad/vendor/1.0/apps/{appId}/{accountId}
app.use('/api/moysklad/vendor/1.0', vendorRouter);

// Iframe + settings save
app.use('/settings', settingsRouter);

// Generic error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'internal_error' });
});

async function start(): Promise<void> {
  await connectDatabase();

  app.listen(config.port, () => {
    logger.info(
      {
        port: config.port,
        publicBaseUrl: config.publicBaseUrl,
        appUid: config.moysklad.appUid,
        appId: config.moysklad.appId,
      },
      'Server started'
    );
  });
}

start().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
