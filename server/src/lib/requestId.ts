import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

const ID_HEADER = 'x-request-id';

function isValidIncoming(value: string): boolean {
  return value.length > 0 && value.length <= 80 && /^[A-Za-z0-9_-]+$/.test(value);
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers[ID_HEADER];
  if (typeof incoming === 'string' && isValidIncoming(incoming)) {
    req.id = incoming;
  } else {
    req.id = randomBytes(8).toString('hex');
  }
  res.setHeader('X-Request-Id', req.id);
  next();
}
