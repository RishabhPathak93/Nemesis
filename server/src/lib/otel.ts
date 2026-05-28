import { logger } from './logger';

/**
 * OpenTelemetry SDK initialisation. Like Sentry, this is OFF entirely unless
 * `OTEL_EXPORTER_OTLP_ENDPOINT` is set — preserves the no-telemetry-phone-home
 * contract. Operators opt in by pointing at their own collector
 * (Honeycomb / Grafana Cloud / self-hosted Tempo / etc.).
 *
 * Imported and called from index.ts BEFORE any other instrumented module,
 * since auto-instrumentation patches modules at require time.
 */

const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '';
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'cortexview-server';

let started = false;

export function initOtel(): void {
  if (started || !OTLP_ENDPOINT) return;

  // Lazy require so the SDK doesn't even load when OTel is disabled — keeps
  // dev startup fast and avoids dragging in instrumentation patches.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { NodeSDK } = require('@opentelemetry/sdk-node') as typeof import('@opentelemetry/sdk-node');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http') as typeof import('@opentelemetry/exporter-trace-otlp-http');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node') as typeof import('@opentelemetry/auto-instrumentations-node');

  const sdk = new NodeSDK({
    serviceName: SERVICE_NAME,
    traceExporter: new OTLPTraceExporter({ url: `${OTLP_ENDPOINT.replace(/\/$/, '')}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable noisy filesystem traces in dev — re-enable per-operator preference.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        // Net traces double up with HTTP — keep HTTP only.
        '@opentelemetry/instrumentation-net': { enabled: false },
      }),
    ],
  });

  try {
    sdk.start();
    started = true;
    logger.info({ endpoint: OTLP_ENDPOINT, service: SERVICE_NAME }, 'OpenTelemetry initialised');
  } catch (err) {
    logger.warn({ err }, 'OpenTelemetry init failed; continuing without tracing');
  }

  process.on('SIGTERM', () => {
    sdk.shutdown().catch((err) => logger.warn({ err }, 'OTel shutdown failed'));
  });
}
