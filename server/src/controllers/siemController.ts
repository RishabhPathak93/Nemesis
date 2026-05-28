import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { auditFromRequest } from '../lib/audit';
import { HttpError } from '../middleware/errorHandler';
import { encodeSiemConfig } from '../services/siem';

const KIND = z.enum(['SPLUNK_HEC', 'DATADOG', 'SYSLOG_HTTP']);

const ConfigSchemas = {
  SPLUNK_HEC: z.object({
    url: z.string().url(),
    token: z.string().min(1),
    index: z.string().optional(),
    sourcetype: z.string().optional(),
  }),
  DATADOG: z.object({
    site: z.string().min(1), // e.g. "datadoghq.com" / "datadoghq.eu"
    apiKey: z.string().min(1),
    service: z.string().optional(),
    ddsource: z.string().optional(),
  }),
  SYSLOG_HTTP: z.object({
    url: z.string().url(),
    bearerToken: z.string().optional(),
  }),
};

const CreateSchema = z.object({
  kind: KIND,
  name: z.string().min(1).max(100),
  config: z.record(z.unknown()),
  actionFilter: z.array(z.string()).optional(),
});

const UpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
  actionFilter: z.array(z.string()).optional(),
});

function maskRow(r: { id: string; orgId: string; kind: string; name: string; enabled: boolean; actionFilter: string[]; lastForwardedAt: Date | null; failureCount: number; createdAt: Date }) {
  return r;
}

export async function listForwarders(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const rows = await prisma.siemForwarder.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, orgId: true, kind: true, name: true, enabled: true, actionFilter: true, lastForwardedAt: true, failureCount: true, createdAt: true },
    });
    res.json({ forwarders: rows.map(maskRow) });
  } catch (err) { next(err); }
}

export async function createForwarder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const userId = req.user!.userId;
    const body = CreateSchema.parse(req.body);
    const validated = (ConfigSchemas[body.kind] as z.ZodType).parse(body.config);
    const fw = await prisma.siemForwarder.create({
      data: {
        orgId,
        kind: body.kind,
        name: body.name,
        configEnc: encodeSiemConfig(validated),
        actionFilter: body.actionFilter ?? [],
        createdById: userId,
      },
    });
    await auditFromRequest(req, {
      action: 'siem.forwarder.create',
      targetType: 'siem_forwarder',
      targetId: fw.id,
      metadata: { kind: body.kind, name: body.name },
    });
    res.status(201).json(maskRow(fw));
  } catch (err) { next(err); }
}

export async function updateForwarder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const id = req.params.id;
    const existing = await prisma.siemForwarder.findFirst({ where: { id, orgId } });
    if (!existing) throw new HttpError(404, 'forwarder not found');
    const body = UpdateSchema.parse(req.body);
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.actionFilter !== undefined) data.actionFilter = body.actionFilter;
    if (body.config !== undefined) {
      const validated = (ConfigSchemas[existing.kind as keyof typeof ConfigSchemas] as z.ZodType).parse(body.config);
      data.configEnc = encodeSiemConfig(validated);
    }
    await prisma.siemForwarder.update({ where: { id }, data });
    await auditFromRequest(req, {
      action: 'siem.forwarder.update',
      targetType: 'siem_forwarder',
      targetId: id,
      metadata: { changed: Object.keys(data) },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function deleteForwarder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const id = req.params.id;
    const existing = await prisma.siemForwarder.findFirst({ where: { id, orgId } });
    if (!existing) throw new HttpError(404, 'forwarder not found');
    await prisma.siemForwarder.delete({ where: { id } });
    await auditFromRequest(req, { action: 'siem.forwarder.delete', targetType: 'siem_forwarder', targetId: id });
    res.json({ ok: true });
  } catch (err) { next(err); }
}
