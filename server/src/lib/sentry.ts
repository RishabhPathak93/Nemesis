import * as Sentry from '@sentry/node';
import { logger } from './logger';

/**
 * Sentry initialisation. Off entirely unless SENTRY_DSN is set — preserves
 * the "no telemetry phone-home" contract. Operators opt in by setting
 * SENTRY_DSN to their own Sentry project. Tracing samples 10% by default.
 */

const SENTRY_DSN = process.env.SENTRY_DSN || '';

let initialised = false;

export function initSentry(): void {
  if (initialised || !SENTRY_DSN) return;
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || 'cortexview@dev',
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    sendDefaultPii: false,
  });
  initialised = true;
  logger.info({ env: process.env.NODE_ENV }, 'Sentry initialised');
}

export const SentryHandlers = Sentry;
export { Sentry };
