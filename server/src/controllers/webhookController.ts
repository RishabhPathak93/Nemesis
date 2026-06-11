import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { encrypt } from '../lib/crypto';
import { generateWebhookSecret } from '../lib/webhookSigner';
import { auditFromRequest } from '../lib/audit';
import { HttpError } from '../middleware/errorHandler';
import { webhookQueue } from '../queues/webhookQueue';
import { assertOutboundUrlAllowed } from '../lib/urlValidation';

export const KNOWN_EVENTS = [
  'report.completed',
  'run.completed',
  'run.failed',
  'share.viewed',
  'agent.created',
  'audit.event',
] as const;

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  events: z.array(z.string()).default([]),
});

const UpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().url().optional(),
  events: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

function maskWebhook(w: { id: string; orgId: string; name: string; url: string; events: string[]; enabled: boolean; createdAt: Date; lastDeliveryAt: Date | null; failureCount: number }) {
  return { ...w, secret: undefined };
}

export async function listWebhooks(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const webhooks = await prisma.webhook.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, orgId: true, name: true, url: true, events: true, enabled: true,
        createdAt: true, lastDeliveryAt: true, failureCount: true,
      },
    });
    res.json({ webhooks: webhooks.map(maskWebhook), knownEvents: KNOWN_EVENTS });
  } catch (err) { next(err); }
}

export async function createWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const userId = req.user!.userId;
    const body = CreateSchema.parse(req.body);
    if (!body.url.startsWith('https://') && !body.url.startsWith('http://')) {
      throw new HttpError(400, 'url must be http(s)://');
    }
    // NEM-2026-006: same SSRF defense as agent endpoints.
    try {
      await assertOutboundUrlAllowed(body.url);
    } catch (err) {
      throw new HttpError(400, `Webhook URL rejected: ${(err as Error).message}`);
    }
    const secret = generateWebhookSecret();
    const webhook = await prisma.webhook.create({
      data: {
        orgId,
        name: body.name,
        url: body.url,
        events: body.events,
        secret: encrypt(secret),
        createdById: userId,
      },
    });
    await auditFromRequest(req, {
      action: 'webhook.create',
      targetType: 'webhook',
      targetId: webhook.id,
      metadata: { name: body.name, eventCount: body.events.length },
    });
    // Secret returned ONCE on create — never re-shown.
    res.status(201).json({ ...maskWebhook(webhook), secret });
  } catch (err) { next(err); }
}

export async function updateWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const id = req.params.id;
    const existing = await prisma.webhook.findFirst({ where: { id, orgId } });
    if (!existing) throw new HttpError(404, 'webhook not found');
    const data = UpdateSchema.parse(req.body);
    // M-05: re-run the SSRF gate when the URL changes — createWebhook validates
    // it, but update previously did not, so an org could create at an allowed
    // URL and then PATCH it to an internal one.
    if (data.url !== undefined) {
      if (!data.url.startsWith('https://') && !data.url.startsWith('http://')) {
        throw new HttpError(400, 'url must be http(s)');
      }
      await assertOutboundUrlAllowed(data.url);
    }
    const updated = await prisma.webhook.update({
      where: { id },
      data,
      select: {
        id: true, orgId: true, name: true, url: true, events: true, enabled: true,
        createdAt: true, lastDeliveryAt: true, failureCount: true,
      },
    });
    await auditFromRequest(req, {
      action: 'webhook.update',
      targetType: 'webhook',
      targetId: id,
      metadata: { changed: Object.keys(data) },
    });
    res.json(maskWebhook(updated));
  } catch (err) { next(err); }
}

export async function deleteWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const id = req.params.id;
    const existing = await prisma.webhook.findFirst({ where: { id, orgId } });
    if (!existing) throw new HttpError(404, 'webhook not found');
    await prisma.webhook.delete({ where: { id } });
    await auditFromRequest(req, { action: 'webhook.delete', targetType: 'webhook', targetId: id });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function rotateSecret(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const id = req.params.id;
    const existing = await prisma.webhook.findFirst({ where: { id, orgId } });
    if (!existing) throw new HttpError(404, 'webhook not found');

    // 24h overlap: preserve the OLD encrypted secret as `secretPrevious` so the
    // worker can emit `X-Cortexview-Signature-Previous` until the window expires.
    // Receivers can verify either signature, giving operators a deploy window.
    const overlapExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const newSecret = generateWebhookSecret();
    await prisma.webhook.update({
      where: { id },
      data: {
        secret: encrypt(newSecret),
        secretPrevious: existing.secret,             // already encrypted
        secretPreviousExpiresAt: overlapExpiry,
      },
    });
    await auditFromRequest(req, {
      action: 'webhook.rotate_secret',
      targetType: 'webhook',
      targetId: id,
      metadata: { overlapExpiresAt: overlapExpiry.toISOString() },
    });
    res.json({ secret: newSecret, overlapExpiresAt: overlapExpiry.toISOString() });
  } catch (err) { next(err); }
}

export async function testWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const id = req.params.id;
    const webhook = await prisma.webhook.findFirst({ where: { id, orgId } });
    if (!webhook) throw new HttpError(404, 'webhook not found');
    const eventId = `evt_test_${Date.now()}`;
    const delivery = await prisma.webhookDelivery.create({
      data: {
        webhookId: webhook.id,
        eventId,
        eventType: 'cortexview.test',
        payload: { message: 'Test event from Nemesis AI', orgId } as never,
        status: 'PENDING',
      },
    });
    await webhookQueue.add({ deliveryId: delivery.id });
    await auditFromRequest(req, { action: 'webhook.test', targetType: 'webhook', targetId: id });
    res.json({ ok: true, deliveryId: delivery.id });
  } catch (err) { next(err); }
}

export async function listDeliveries(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const id = req.params.id;
    const webhook = await prisma.webhook.findFirst({ where: { id, orgId } });
    if (!webhook) throw new HttpError(404, 'webhook not found');
    const deliveries = await prisma.webhookDelivery.findMany({
      where: { webhookId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ deliveries });
  } catch (err) { next(err); }
}
