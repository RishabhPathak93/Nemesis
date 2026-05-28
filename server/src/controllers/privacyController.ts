import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { auditFromRequest } from '../lib/audit';
import { HttpError } from '../middleware/errorHandler';

/** Current document versions — operators can override per environment. */
const CURRENT_VERSIONS = {
  TOS: process.env.TOS_VERSION || '2026-05-09.v1',
  PRIVACY: process.env.PRIVACY_VERSION || '2026-05-09.v1',
  DPA: process.env.DPA_VERSION || '2026-05-09.v1',
} as const;

type DocType = keyof typeof CURRENT_VERSIONS;

const AcceptSchema = z.object({
  docType: z.enum(['TOS', 'PRIVACY', 'DPA']),
  version: z.string().min(1),
});

export async function getRequiredAcceptances(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const accepted = await prisma.privacyAcceptance.findMany({ where: { userId } });
    const acceptedMap = new Map<string, string>();
    for (const a of accepted) acceptedMap.set(a.docType, a.version);
    const required: Array<{ docType: DocType; version: string; alreadyAccepted: boolean }> = [];
    for (const [docType, version] of Object.entries(CURRENT_VERSIONS) as Array<[DocType, string]>) {
      required.push({ docType, version, alreadyAccepted: acceptedMap.get(docType) === version });
    }
    const allAccepted = required.every((r) => r.alreadyAccepted);
    res.json({ required, allAccepted });
  } catch (err) { next(err); }
}

export async function recordAcceptance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const body = AcceptSchema.parse(req.body);
    if (CURRENT_VERSIONS[body.docType] !== body.version) {
      throw new HttpError(400, `version mismatch — current ${body.docType} version is ${CURRENT_VERSIONS[body.docType]}`);
    }
    await prisma.privacyAcceptance.upsert({
      where: { userId_docType_version: { userId, docType: body.docType, version: body.version } },
      create: { userId, docType: body.docType, version: body.version, ip: req.ip ?? null },
      update: { acceptedAt: new Date(), ip: req.ip ?? null },
    });
    await auditFromRequest(req, {
      action: 'legal.acceptance.recorded',
      targetType: 'user',
      targetId: userId,
      metadata: { docType: body.docType, version: body.version },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
}
