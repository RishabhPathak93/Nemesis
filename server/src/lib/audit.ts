import type { Request } from 'express';
import { prisma } from './prisma';
import { logger } from './logger';

export type ActorType = 'user' | 'api_key' | 'system' | 'share_link';

export interface AuditEvent {
  orgId: string;
  actorId?: string | null;
  actorType?: ActorType;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** Field-name fragments that signal a value should never be persisted in metadata. */
const SECRET_KEY_HINTS = ['password', 'secret', 'apikey', 'api_key', 'token', 'cookie', 'authorization'];

function isSecretKey(k: string): boolean {
  const lower = k.toLowerCase();
  return SECRET_KEY_HINTS.some((h) => lower.includes(h));
}

/** Recursively scrub anything that looks secret. Caps depth + size to keep audit rows bounded. */
export function sanitiseMetadata(input: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-capped]';
  if (input == null || typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.slice(0, 50).map((v) => sanitiseMetadata(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (isSecretKey(k)) {
      out[k] = '[redacted]';
    } else if (typeof v === 'string' && v.length > 1000) {
      out[k] = v.slice(0, 1000) + '…';
    } else {
      out[k] = sanitiseMetadata(v, depth + 1);
    }
  }
  return out;
}

/** Fire-and-forget audit write. Failures are logged but do not break the calling request. */
export async function writeAudit(event: AuditEvent): Promise<void> {
  try {
    const meta = event.metadata ? (sanitiseMetadata(event.metadata) as Record<string, unknown>) : null;
    const row = await prisma.auditLog.create({
      data: {
        orgId: event.orgId,
        actorId: event.actorId ?? null,
        actorType: event.actorType ?? (event.actorId ? 'user' : 'system'),
        action: event.action,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        ip: event.ip ?? null,
        userAgent: event.userAgent ?? null,
        metadata: meta as never,
      },
    });
    // v2.0 — fan out to SIEM forwarders. Lazy import keeps the path cold when
    // no forwarders are configured (the lookup itself is O(1) cached query).
    void (async () => {
      try {
        const { forwardToSiem } = await import('../services/siem');
        await forwardToSiem({
          id: row.id,
          orgId: row.orgId,
          action: row.action,
          actorId: row.actorId,
          actorType: row.actorType,
          targetType: row.targetType,
          targetId: row.targetId,
          ip: row.ip,
          metadata: row.metadata,
          createdAt: row.createdAt,
        });
      } catch (err) {
        logger.warn({ err }, 'SIEM forward setup failed');
      }
    })();
  } catch (err) {
    logger.warn({ err, action: event.action, orgId: event.orgId }, 'audit write failed');
  }
}

/** Convenience wrapper that pulls actor + ip + UA + requestId from the Request. */
export async function auditFromRequest(
  req: Request,
  partial: Omit<AuditEvent, 'orgId' | 'actorId' | 'actorType' | 'ip' | 'userAgent'> & {
    orgId?: string;
    actorId?: string | null;
    actorType?: ActorType;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const orgId = partial.orgId ?? req.user?.orgId;
  // Explicit null means "system / unauthenticated" — preserve it.
  const actorId = partial.actorId === null ? null : (partial.actorId ?? req.user?.userId);
  if (!orgId) return; // can't audit without an org bucket
  const merged: Record<string, unknown> | undefined = {
    requestId: req.id,
    ...(partial.metadata ?? {}),
  };
  await writeAudit({
    orgId,
    actorId,
    actorType: partial.actorType,
    action: partial.action,
    targetType: partial.targetType,
    targetId: partial.targetId,
    metadata: merged,
    ip: req.ip ?? null,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  });
}
