/**
 * Hand-curated OpenAPI 3.1 schema for the public Nemesis AI API. Served at
 * /api/v1/openapi.json. The schema is intentionally minimal — covers the
 * stable endpoints we'll commit to versioning across v1.4 → v2.0. Endpoints
 * not listed here are still functional but are not part of the v1
 * stability contract.
 *
 * v1 stability promise: paths and request/response field names listed below
 * will not change in a backward-incompatible way without a major version bump.
 */

export const OPENAPI_V1 = {
  openapi: '3.1.0',
  info: {
    title: 'Nemesis AI API',
    version: '1.0.0',
    description: 'Stable v1 surface for the Nemesis AI adversarial-testing platform.',
    license: { name: 'Proprietary — Nemesis AI' },
  },
  servers: [{ url: '/api/v1' }, { url: '/api', description: 'Legacy alias (deprecated; will be removed in v2.0)' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    },
    schemas: {
      Probe: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          slug: { type: 'string' },
          source: { type: 'string', enum: ['cortexview_kb', 'cortexview_curated', 'cortexview_learned'] },
          category: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          title: { type: 'string' },
          description: { type: 'string' },
          seedPayload: { type: 'string' },
          applicability: { type: 'array', items: { type: 'string' } },
          enabled: { type: 'boolean' },
        },
      },
      Webhook: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          url: { type: 'string', format: 'uri' },
          events: { type: 'array', items: { type: 'string' } },
          enabled: { type: 'boolean' },
        },
      },
      Error: {
        type: 'object',
        properties: { error: { type: 'string' }, requestId: { type: 'string' } },
      },
    },
  },
  security: [{ bearerAuth: [] }, { apiKey: [] }],
  paths: {
    '/health': { get: { operationId: 'getHealth', tags: ['ops'], summary: 'Liveness probe', security: [], responses: { '200': { description: 'OK' } } } },
    '/health/deep': { get: { operationId: 'getHealthDeep', tags: ['ops'], summary: 'Dependency-checking readiness probe (gated by X-Health-Token)', security: [], responses: { '200': { description: 'OK' }, '503': { description: 'Degraded' } } } },
    '/auth/login': {
      post: {
        operationId: 'login', tags: ['auth'], summary: 'Username + password sign-in (may require MFA)', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } } } } } },
        responses: { '200': { description: 'OK' }, '401': { description: 'Bad credentials' }, '423': { description: 'Account locked' } },
      },
    },
    '/auth/refresh': {
      post: {
        operationId: 'refresh', tags: ['auth'], summary: 'Rotate refresh token', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } } } } },
        responses: { '200': { description: 'OK' }, '401': { description: 'Invalid or revoked' } },
      },
    },
    '/agents': {
      get: { operationId: 'listAgents', tags: ['agents'], summary: 'List agents in the calling org', responses: { '200': { description: 'OK' } } },
      post: { operationId: 'createAgent', tags: ['agents'], summary: 'Create a new agent', responses: { '201': { description: 'Created' } } },
    },
    '/agents/{id}/run-tests': { post: { operationId: 'runAgentTests', tags: ['runs'], summary: 'Generate + execute the test suite', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '202': { description: 'Accepted; testRunId returned' } } } },
    '/test-runs/{id}/status': { get: { operationId: 'getTestRunStatus', tags: ['runs'], summary: 'Poll a running test', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } } },
    '/test-runs/{id}/cancel': { post: { operationId: 'cancelTestRun', tags: ['runs'], summary: 'Request graceful cancellation of an in-flight run', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Accepted' } } } },
    '/reports/{id}': { get: { operationId: 'getReport', tags: ['reports'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } } },
    '/reports/{id}/export': { get: { operationId: 'exportReport', tags: ['reports'], summary: 'Server-side HTML render with org branding', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'format', in: 'query', schema: { type: 'string', enum: ['html'] } }], responses: { '200': { description: 'HTML', content: { 'text/html': {} } } } } },
    '/security-engine/probes': { get: { operationId: 'listProbes', tags: ['security-engine'], summary: 'Browse the probe catalog', responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { probes: { type: 'array', items: { $ref: '#/components/schemas/Probe' } } } } } } } } } },
    '/security-engine/compliance/heatmap': { get: { operationId: 'complianceHeatmap', tags: ['security-engine'], summary: 'OWASP/MITRE/NIST/EU AI Act control coverage', responses: { '200': { description: 'OK' } } } },
    '/settings/webhooks': {
      get: { operationId: 'listWebhooks', tags: ['integrations'], responses: { '200': { description: 'OK' } } },
      post: { operationId: 'createWebhook', tags: ['integrations'], summary: 'Create webhook (returns secret ONCE)', responses: { '201': { description: 'Created' } } },
    },
    '/settings/scheduled-reports': {
      get: { operationId: 'listScheduledReports', tags: ['integrations'], responses: { '200': { description: 'OK' } } },
      post: { operationId: 'createScheduledReport', tags: ['integrations'], summary: 'Schedule a report (cron expression + IANA tz)', responses: { '201': { description: 'Created' } } },
    },
    '/data-subject-requests': {
      get: { operationId: 'listDsrs', tags: ['compliance'], summary: 'List GDPR/CCPA data subject requests', responses: { '200': { description: 'OK' } } },
      post: { operationId: 'createDsr', tags: ['compliance'], summary: 'Submit a data export or delete request', responses: { '201': { description: 'Created' } } },
    },
  },
  tags: [
    { name: 'ops', description: 'Health and metrics' },
    { name: 'auth', description: 'Authentication, sessions, MFA' },
    { name: 'agents', description: 'Target agent CRUD' },
    { name: 'runs', description: 'Test runs and cancellation' },
    { name: 'reports', description: 'Reports and exports' },
    { name: 'security-engine', description: 'Probe / strategy / detector catalog' },
    { name: 'integrations', description: 'Webhooks, notifications, scheduled reports' },
    { name: 'compliance', description: 'GDPR DSR, policy, quotas, legal acceptance' },
  ],
} as const;
