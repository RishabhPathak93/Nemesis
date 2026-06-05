import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  base: { service: 'cortexview-server' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'req.headers["x-health-token"]',
      '*.password',
      '*.apiKey',
      '*.token',
      '*.tokenHash',
      '*.mfaSecret',
      // L-04: keep OAuth client-credential secrets + raw outbound request
      // bodies (e.g. the MS Graph token request) out of logs.
      '*.client_secret',
      '*.clientSecret',
      'err.config.data',
      '*.config.data',
    ],
    censor: '[redacted]',
  },
});
