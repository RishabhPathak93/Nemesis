import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { auditFromRequest } from '../lib/audit';
import { HttpError } from '../middleware/errorHandler';
import { generateComplianceEvidenceNow } from '../queues/complianceEvidenceQueue';

export async function listEvidence(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const rows = await prisma.complianceEvidence.findMany({
      where: { orgId },
      orderBy: { generatedAt: 'desc' },
      take: 50,
    });
    res.json({ evidence: rows });
  } catch (err) { next(err); }
}

export async function generateEvidenceNow(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const days = Math.min(parseInt(String((req.body as { days?: unknown })?.days ?? '90'), 10) || 90, 365);
    const out = await generateComplianceEvidenceNow(orgId, days);
    await auditFromRequest(req, {
      action: 'compliance.evidence.requested',
      targetType: 'compliance_evidence',
      targetId: out.id,
      metadata: { days },
    });
    res.json(out);
  } catch (err) { next(err); }
}

export async function downloadEvidence(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const id = req.params.id;
    const ev = await prisma.complianceEvidence.findFirst({ where: { id, orgId } });
    if (!ev) throw new HttpError(404, 'evidence not found');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="evidence-${id}.json"`);
    res.sendFile(ev.contentPath);
  } catch (err) { next(err); }
}
