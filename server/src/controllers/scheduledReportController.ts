import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import cronParser from 'cron-parser';
import { prisma } from '../lib/prisma';
import { auditFromRequest } from '../lib/audit';
import { HttpError } from '../middleware/errorHandler';
import { runScheduledReport, nextRunFor } from '../services/scheduledRunner';

const SCOPE = z.enum(['ORG', 'AGENT']);
const FORMAT = z.enum(['HTML', 'PDF']);

const CreateSchema = z.object({
  scope: SCOPE.default('AGENT'),
  agentId: z.string().nullable().optional(),
  cronExpr: z.string().min(1),
  timezone: z.string().default('UTC'),
  channels: z.array(z.string()).min(1),
  format: FORMAT.default('HTML'),
});
const UpdateSchema = CreateSchema.partial().extend({ enabled: z.boolean().optional() });

function validateCron(expr: string, tz: string): void {
  try { cronParser.parseExpression(expr, { tz }); }
  catch { throw new HttpError(400, `invalid cron expression: ${expr}`); }
}

export async function listScheduledReports(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const reports = await prisma.scheduledReport.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ scheduledReports: reports });
  } catch (err) { next(err); }
}

export async function createScheduledReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const userId = req.user!.userId;
    const body = CreateSchema.parse(req.body);
    validateCron(body.cronExpr, body.timezone);
    if (body.scope === 'AGENT' && !body.agentId) throw new HttpError(400, 'agentId required for AGENT scope');
    if (body.agentId) {
      const agent = await prisma.agent.findFirst({ where: { id: body.agentId, orgId } });
      if (!agent) throw new HttpError(404, 'agent not found');
    }
    // Validate channel ids belong to the org.
    const channels = await prisma.notificationChannel.findMany({ where: { id: { in: body.channels }, orgId } });
    if (channels.length !== body.channels.length) throw new HttpError(400, 'one or more channel ids not found in your org');

    const next = nextRunFor(body.cronExpr, body.timezone);
    const sched = await prisma.scheduledReport.create({
      data: {
        orgId,
        scope: body.scope,
        agentId: body.agentId ?? null,
        cronExpr: body.cronExpr,
        timezone: body.timezone,
        channels: body.channels,
        format: body.format,
        nextRunAt: next ?? null,
        createdById: userId,
      },
    });
    await auditFromRequest(req, {
      action: 'scheduled_report.create',
      targetType: 'scheduled_report',
      targetId: sched.id,
      metadata: { scope: body.scope, cronExpr: body.cronExpr, channelCount: body.channels.length, format: body.format },
    });
    res.status(201).json(sched);
  } catch (err) { next(err); }
}

export async function updateScheduledReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const id = req.params.id;
    const existing = await prisma.scheduledReport.findFirst({ where: { id, orgId } });
    if (!existing) throw new HttpError(404, 'scheduled report not found');
    const body = UpdateSchema.parse(req.body);
    const data: Record<string, unknown> = { ...body };
    if (body.cronExpr || body.timezone) {
      validateCron(body.cronExpr ?? existing.cronExpr, body.timezone ?? existing.timezone);
      data.nextRunAt = nextRunFor(body.cronExpr ?? existing.cronExpr, body.timezone ?? existing.timezone) ?? null;
    }
    await prisma.scheduledReport.update({ where: { id }, data });
    await auditFromRequest(req, {
      action: 'scheduled_report.update',
      targetType: 'scheduled_report',
      targetId: id,
      metadata: { changed: Object.keys(body) },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function deleteScheduledReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const id = req.params.id;
    const existing = await prisma.scheduledReport.findFirst({ where: { id, orgId } });
    if (!existing) throw new HttpError(404, 'scheduled report not found');
    await prisma.scheduledReport.delete({ where: { id } });
    await auditFromRequest(req, { action: 'scheduled_report.delete', targetType: 'scheduled_report', targetId: id });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function runNow(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const id = req.params.id;
    const existing = await prisma.scheduledReport.findFirst({ where: { id, orgId } });
    if (!existing) throw new HttpError(404, 'scheduled report not found');
    // Fire-and-forget; the runner writes its own ScheduledReportRun row.
    void runScheduledReport(id);
    await auditFromRequest(req, { action: 'scheduled_report.run_now', targetType: 'scheduled_report', targetId: id });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function listRuns(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const id = req.params.id;
    const sched = await prisma.scheduledReport.findFirst({ where: { id, orgId } });
    if (!sched) throw new HttpError(404, 'scheduled report not found');
    const runs = await prisma.scheduledReportRun.findMany({
      where: { scheduledReportId: id },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    res.json({ runs });
  } catch (err) { next(err); }
}
