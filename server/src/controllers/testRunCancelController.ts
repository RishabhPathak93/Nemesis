import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { auditFromRequest } from '../lib/audit';
import { HttpError } from '../middleware/errorHandler';

/**
 * v1.4 — POST /api/test-runs/:id/cancel
 * Sets cancelRequested=true; the testRunner checks this flag at phase
 * boundaries (preparing → executing → reporting) and finalises with
 * status=FAILED, cancelledAt + cancelledById set.
 */
export async function cancelTestRun(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const userId = req.user!.userId;
    const id = req.params.id;
    const run = await prisma.testRun.findFirst({
      where: { id, suite: { agent: { orgId } } },
    });
    if (!run) throw new HttpError(404, 'test run not found');
    if (run.status === 'COMPLETED' || run.status === 'FAILED') {
      throw new HttpError(400, `cannot cancel a ${run.status} run`);
    }
    await prisma.testRun.update({
      where: { id },
      data: { cancelRequested: true, cancelledById: userId },
    });
    await auditFromRequest(req, {
      action: 'test_run.cancel',
      targetType: 'test_run',
      targetId: id,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
}
