import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../lib/logger';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation error', details: err.flatten(), requestId: req.id });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, requestId: req.id });
    return;
  }
  logger.error(
    { err, requestId: req.id, path: req.path, method: req.method, userId: req.user?.userId, orgId: req.user?.orgId },
    'unhandled request error',
  );
  res.status(500).json({ error: 'Internal server error', requestId: req.id });
}
