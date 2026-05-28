import client from 'prom-client';
import type { Request, Response, NextFunction } from 'express';
import { env } from './env';
import { timingSafeEqualString } from './tokens';

/**
 * Prometheus metrics. Default Node + GC + event-loop metrics are scraped
 * automatically; we add a small set of CortexView-specific counters and
 * histograms that operators care about.
 *
 * Endpoint: GET /metrics — gated by X-Metrics-Token to avoid open scraping.
 */

client.collectDefaultMetrics({ prefix: 'cv_' });

const httpRequestsTotal = new client.Counter({
  name: 'cv_http_requests_total',
  help: 'HTTP requests grouped by method, route, status family.',
  labelNames: ['method', 'route', 'status'],
});

const httpRequestDuration = new client.Histogram({
  name: 'cv_http_request_duration_seconds',
  help: 'HTTP request duration in seconds.',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.025, 0.1, 0.5, 1, 5, 30],
});

export const auditEventsTotal = new client.Counter({
  name: 'cv_audit_events_total',
  help: 'Audit events written, grouped by action.',
  labelNames: ['action'],
});

export const queueJobsTotal = new client.Counter({
  name: 'cv_queue_jobs_total',
  help: 'Bull queue jobs by name and outcome.',
  labelNames: ['queue', 'outcome'], // outcome: started|succeeded|failed|deadlettered
});

export const llmCallsTotal = new client.Counter({
  name: 'cv_llm_calls_total',
  help: 'LLM provider calls grouped by provider and outcome.',
  labelNames: ['provider', 'outcome'],
});

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const route = req.route?.path ?? req.path.replace(/\/[a-z0-9]{20,}/g, '/:id');
    const status = `${Math.floor(res.statusCode / 100)}xx`;
    const labels = { method: req.method, route, status };
    httpRequestsTotal.inc(labels);
    const ns = Number(process.hrtime.bigint() - start);
    httpRequestDuration.observe(labels, ns / 1e9);
  });
  next();
}

export async function metricsHandler(req: Request, res: Response): Promise<void> {
  if (env.metricsToken) {
    const provided = req.headers['x-metrics-token'];
    // NEM-2026-009: timing-safe compare.
    if (typeof provided !== 'string' || !timingSafeEqualString(provided, env.metricsToken)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
  }
  res.setHeader('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
}
