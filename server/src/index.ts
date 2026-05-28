import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './lib/env';
import { logger } from './lib/logger';
import { requestId } from './lib/requestId';
import { generalLimiter } from './lib/rateLimits';
import { healthHandler, healthDeepHandler } from './lib/health';
import { csrfMiddleware } from './lib/csrf';
import { authMiddleware } from './middleware/auth';
import { initOtel } from './lib/otel';
import { initSentry, Sentry } from './lib/sentry';
import { metricsMiddleware, metricsHandler } from './lib/metrics';
import { OPENAPI_V1 } from './lib/openapi';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';
import './queues/testRunQueue'; // ensure queue worker starts
import './queues/webhookQueue';
import './queues/scheduledReportQueue';
import './queues/retentionQueue';
import './queues/complianceEvidenceQueue';

// OTel must initialise FIRST so its auto-instrumentations patch modules at
// require time. Skipped when OTEL_EXPORTER_OTLP_ENDPOINT is unset.
initOtel();
initSentry();

const app = express();

// Honour X-Forwarded-* from the operator's reverse proxy (nginx, ALB, etc.)
app.set('trust proxy', 1);

app.use(requestId);
app.use(metricsMiddleware);
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => (req as express.Request).id,
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  }),
);

// Security headers. CSP belongs on the static client host (nginx), not the API,
// so we disable it here to avoid blocking JSON responses with overly strict policies.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    // NEM-2026-019: strip X-Powered-By so we don't advertise Express.
    hidePoweredBy: true,
  }),
);
// Strip any residual Server/X-Powered-By headers the framework or upstream
// proxies might add. Belt-and-braces over the helmet directive.
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.removeHeader('Server');
  res.removeHeader('X-Powered-By');
  next();
});

app.use(generalLimiter);

app.use(
  cors({
    origin: env.clientOrigin,
    credentials: true,
  }),
);
app.use(express.json({ limit: '5mb' }));
// NEM-2026-027: turn body-parser parse errors into a clean 400 rather than
// a 500 + stack leak in production logs.
const jsonParseErrorHandler: ErrorRequestHandler = (err, req, _res, next) => {
  if (err && (err as { type?: string }).type === 'entity.parse.failed') {
    return next(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
  }
  next(err);
};
app.use(jsonParseErrorHandler);
app.use(cookieParser());

// CSRF — selective enforcement (skipped for Bearer/API-key/non-cookie clients).
// Runs after cookieParser since it reads/sets the cv_csrf cookie. Applied to
// both /api (legacy) and /api/v1 (stable surface).
app.use(['/api', '/api/v1'], csrfMiddleware);

app.get('/health', healthHandler);
app.get('/health/deep', healthDeepHandler);
app.get('/metrics', metricsHandler);
// NEM-2026-020: OpenAPI spec exposes the full admin/SCIM/SAML surface (paths,
// schemas, security schemes). Gate behind authentication so unauthenticated
// attackers can't enumerate the API surface during recon.
app.get('/api/v1/openapi.json', authMiddleware, (_req, res) => res.json(OPENAPI_V1));
app.get('/api/openapi.json', authMiddleware, (_req, res) => res.json(OPENAPI_V1));
app.get('/api/v1/openapi-derived.json', authMiddleware, async (_req, res, next) => {
  try {
    const { generateDerivedOpenApi } = await import('./lib/openapiRegistry');
    res.json(generateDerivedOpenApi());
  } catch (err) { next(err); }
});

// Mount the unified router at both /api (legacy) and /api/v1 (stable surface).
// /api responses get a deprecation warning header so clients migrate.
app.use('/api/v1', routes);
app.use('/api', (req, res, next) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', 'Wed, 01 Apr 2027 00:00:00 GMT');
  res.setHeader('Link', '</api/v1>; rel="successor-version"');
  next();
}, routes);

// Sentry error handler must come AFTER all routes but BEFORE our errorHandler.
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

app.use(errorHandler);

const server = app.listen(env.port, () => {
  logger.info({ port: env.port }, 'Nemesis AI API listening');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
