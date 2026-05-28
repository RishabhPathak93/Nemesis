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
    ],
    censor: '[redacted]',
  },
});
