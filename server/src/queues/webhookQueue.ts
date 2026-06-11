import Bull from 'bull';
import axios from 'axios';
import { env } from '../lib/env';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { decrypt } from '../lib/crypto';
import { sign, SIG_HEADER } from '../lib/webhookSigner';
import { writeAudit } from '../lib/audit';
import { assertOutboundUrlAllowed, safeHttpsAgent } from '../lib/urlValidation';

export interface WebhookJobData {
  deliveryId: string;
}

const RETRY_BACKOFF_MS = 30_000;
const MAX_ATTEMPTS = 8;

export const webhookQueue = new Bull<WebhookJobData>('webhook-deliveries', env.redisUrl, {
  defaultJobOptions: {
    attempts: MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: RETRY_BACKOFF_MS },
    removeOnComplete: 200,
    removeOnFail: 200,
  },
});

webhookQueue.process(4, async (job) => {
  const { deliveryId } = job.data;
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { webhook: true },
  });
  if (!delivery) throw new Error(`delivery ${deliveryId} not found`);
  if (!delivery.webhook.enabled) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'FAILED', errorMessage: 'webhook disabled' },
    });
    return;
  }

  const secret = decrypt(delivery.webhook.secret);
  const body = JSON.stringify({
    eventId: delivery.eventId,
    eventType: delivery.eventType,
    payload: delivery.payload,
    deliveredAt: new Date().toISOString(),
  });
  const signature = sign(body, secret);

  // 24-hour rotation overlap: emit a second signature using the previous
  // secret while it's within its grace window. Receivers can verify either.
  let signaturePrevious: string | undefined;
  if (
    delivery.webhook.secretPrevious &&
    delivery.webhook.secretPreviousExpiresAt &&
    delivery.webhook.secretPreviousExpiresAt > new Date()
  ) {
    try {
      signaturePrevious = sign(body, decrypt(delivery.webhook.secretPrevious));
    } catch {
      // Invalid previous secret — silently skip; primary signature still goes.
    }
  }

  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  let errorMessage: string | null = null;
  let succeeded = false;

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [SIG_HEADER]: signature,
      'X-Cortexview-Event': delivery.eventType,
      'X-Cortexview-Delivery': delivery.id,
      'Idempotency-Key': delivery.eventId,
    };
    if (signaturePrevious) headers[`${SIG_HEADER}-Previous`] = signaturePrevious;
    // NEM-2026-006: DNS-rebinding defense — re-validate at delivery time.
    // A webhook URL that was public at create-time may now resolve to an
    // internal IP. Reject and mark FAILED rather than calling.
    try {
      await assertOutboundUrlAllowed(delivery.webhook.url);
    } catch (err) {
      errorMessage = `URL rejected by SSRF policy: ${(err as Error).message}`;
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: { status: 'FAILED', attempts: { increment: 1 }, errorMessage },
      });
      return;
    }
    const res = await axios.post(delivery.webhook.url, body, {
      headers,
      timeout: 30_000,
      // NEM-2026-024: pin TLS verification.
      httpsAgent: safeHttpsAgent(),
      maxRedirects: 0,
      validateStatus: () => true, // we score by code ourselves
    });
    responseStatus = res.status;
    if (typeof res.data === 'string') responseBody = res.data.slice(0, 2048);
    else if (res.data) responseBody = JSON.stringify(res.data).slice(0, 2048);
    succeeded = res.status >= 200 && res.status < 300;
    if (!succeeded && res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      // Permanent failure — don't retry
      errorMessage = `client error ${res.status}`;
    } else if (!succeeded) {
      errorMessage = `transient error ${res.status}`;
      throw new Error(errorMessage); // triggers Bull retry
    }
  } catch (err) {
    if (responseStatus == null) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }
    // M-10: a pure transport failure (DNS/connection-reset/timeout) leaves
    // responseStatus null. That is TRANSIENT and must be retried — previously
    // the rethrow was gated on `responseStatus !== null`, so transport failures
    // fell through to a terminal FAILED and were never retried despite the
    // 8-attempt backoff. Retry on null-status too.
    const transient =
      responseStatus == null ||
      responseStatus < 400 ||
      responseStatus >= 500 ||
      responseStatus === 408 ||
      responseStatus === 429;
    if (!succeeded && transient) {
      // Update interim state then rethrow for retry
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'FAILED',
          attempts: { increment: 1 },
          responseStatus,
          responseBody,
          errorMessage,
        },
      });
      throw err;
    }
  }

  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: succeeded ? 'SUCCEEDED' : 'FAILED',
      attempts: { increment: 1 },
      responseStatus,
      responseBody,
      errorMessage,
      deliveredAt: succeeded ? new Date() : null,
    },
  });
  await prisma.webhook.update({
    where: { id: delivery.webhookId },
    data: {
      lastDeliveryAt: new Date(),
      ...(succeeded ? { failureCount: 0 } : { failureCount: { increment: 1 } }),
    },
  });
});

webhookQueue.on('failed', async (job, _err) => {
  if (job.attemptsMade < MAX_ATTEMPTS) return; // still retrying
  const { deliveryId } = job.data;
  const delivery = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
  if (!delivery) return;
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: { status: 'DEAD_LETTERED' },
  });
  const webhook = await prisma.webhook.findUnique({ where: { id: delivery.webhookId } });
  if (webhook) {
    await writeAudit({
      orgId: webhook.orgId,
      action: 'webhook.delivery.deadlettered',
      actorType: 'system',
      targetType: 'webhook',
      targetId: webhook.id,
      metadata: { deliveryId, eventType: delivery.eventType, attempts: job.attemptsMade },
    });
  }
});

webhookQueue.on('error', (err) => {
  logger.error({ err }, 'webhook queue error');
});

/** Public helper: enqueue a webhook event for every enabled webhook in an org. */
export async function emitWebhookEvent(orgId: string, eventType: string, payload: unknown): Promise<void> {
  const webhooks = await prisma.webhook.findMany({ where: { orgId, enabled: true } });
  for (const webhook of webhooks) {
    if (webhook.events.length > 0 && !webhook.events.includes(eventType)) continue;
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const delivery = await prisma.webhookDelivery.create({
      data: {
        webhookId: webhook.id,
        eventId,
        eventType,
        payload: payload as never,
        status: 'PENDING',
      },
    });
    await webhookQueue.add({ deliveryId: delivery.id });
  }
}
