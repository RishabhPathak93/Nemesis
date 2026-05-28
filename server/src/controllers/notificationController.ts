import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { auditFromRequest } from '../lib/audit';
import { HttpError } from '../middleware/errorHandler';
import { encodeChannelConfig, sendToChannel } from '../services/channels';

const KIND = z.enum(['EMAIL', 'SLACK', 'TEAMS', 'WEBHOOK', 'JIRA', 'SERVICENOW']);

const ConfigSchemas = {
  EMAIL: z.object({ to: z.array(z.string().email()).min(1) }),
  SLACK: z.object({ incomingWebhookUrl: z.string().url() }),
  TEAMS: z.object({ incomingWebhookUrl: z.string().url() }),
  WEBHOOK: z.object({ webhookId: z.string().min(1) }),
  JIRA: z.object({
    baseUrl: z.string().url(),
    email: z.string().email(),
    apiToken: z.string().min(1),
    projectKey: z.string().min(1),
    issueType: z.string().optional(),
  }),
  SERVICENOW: z.object({
    baseUrl: z.string().url(),
    user: z.string().min(1),
    password: z.string().min(1),
    tableName: z.string().optional(),
  }),
};

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  kind: KIND,
  config: z.record(z.unknown()),
});

const UpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
});

function validateConfig(kind: keyof typeof ConfigSchemas, config: unknown): unknown {
  const schema = ConfigSchemas[kind];
  return schema.parse(config);
}

function maskChannel(c: { id: string; orgId: string; kind: string; name: string; enabled: boolean; createdAt: Date; createdById: string }) {
  return c;
}

export async function listChannels(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const channels = await prisma.notificationChannel.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, orgId: true, kind: true, name: true, enabled: true, createdAt: true, createdById: true },
    });
    res.json({ channels: channels.map(maskChannel) });
  } catch (err) { next(err); }
}

export async function createChannel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const userId = req.user!.userId;
    const body = CreateSchema.parse(req.body);
    const validated = validateConfig(body.kind, body.config);
    const channel = await prisma.notificationChannel.create({
      data: {
        orgId,
        kind: body.kind,
        name: body.name,
        configEnc: encodeChannelConfig(validated),
        createdById: userId,
      },
      select: { id: true, orgId: true, kind: true, name: true, enabled: true, createdAt: true, createdById: true },
    });
    await auditFromRequest(req, {
      action: 'notification_channel.create',
      targetType: 'notification_channel',
      targetId: channel.id,
      metadata: { kind: body.kind, name: body.name },
    });
    res.status(201).json(channel);
  } catch (err) { next(err); }
}

export async function updateChannel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const id = req.params.id;
    const existing = await prisma.notificationChannel.findFirst({ where: { id, orgId } });
    if (!existing) throw new HttpError(404, 'channel not found');
    const body = UpdateSchema.parse(req.body);
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.config !== undefined) {
      const validated = validateConfig(existing.kind as keyof typeof ConfigSchemas, body.config);
      data.configEnc = encodeChannelConfig(validated);
    }
    await prisma.notificationChannel.update({ where: { id }, data });
    await auditFromRequest(req, {
      action: 'notification_channel.update',
      targetType: 'notification_channel',
      targetId: id,
      metadata: { changed: Object.keys(data) },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function deleteChannel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const id = req.params.id;
    const existing = await prisma.notificationChannel.findFirst({ where: { id, orgId } });
    if (!existing) throw new HttpError(404, 'channel not found');
    await prisma.notificationChannel.delete({ where: { id } });
    await auditFromRequest(req, { action: 'notification_channel.delete', targetType: 'notification_channel', targetId: id });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function testChannel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const id = req.params.id;
    const channel = await prisma.notificationChannel.findFirst({ where: { id, orgId } });
    if (!channel) throw new HttpError(404, 'channel not found');
    const result = await sendToChannel(id, {
      subject: 'Nemesis AI test notification',
      body: 'This is a test message sent from your notification channel settings.',
      severity: 'info',
    });
    await auditFromRequest(req, {
      action: 'notification_channel.test',
      targetType: 'notification_channel',
      targetId: id,
      metadata: { ok: result.ok },
    });
    res.json(result);
  } catch (err) { next(err); }
}
