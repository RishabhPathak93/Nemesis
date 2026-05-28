import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { HttpError } from '../middleware/errorHandler';

async function assertTestRunInOrg(testRunId: string, orgId: string) {
  const run = await prisma.testRun.findUnique({
    where: { id: testRunId },
    include: { suite: { include: { agent: true } } },
  });
  if (!run || run.suite.agent.orgId !== orgId) throw new HttpError(404, 'Test run not found');
  return run;
}

export async function getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const run = await assertTestRunInOrg(req.params.id, orgId);
    const counts = await prisma.testResult.groupBy({
      by: ['result'],
      where: { testRunId: run.id },
      _count: { _all: true },
    });
    const summary = counts.reduce<Record<string, number>>((acc, c) => {
      acc[c.result] = c._count._all;
      return acc;
    }, {});
    res.json({
      id: run.id,
      status: run.status,
      phase: run.phase,
      phaseDetail: run.phaseDetail,
      progress: run.progress,
      totalTests: run.totalTests,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      errorMessage: run.errorMessage,
      summary: {
        pass: summary.pass || 0,
        fail: summary.fail || 0,
        partial: summary.partial || 0,
        error: summary.error || 0,
      },
      agentId: run.suite.agent.id,
      agentName: run.suite.agent.name,
    });
  } catch (err) {
    next(err);
  }
}

export async function getReportForRun(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const run = await assertTestRunInOrg(req.params.id, orgId);
    const report = await prisma.report.findUnique({ where: { testRunId: run.id } });
    if (!report) throw new HttpError(404, 'Report not yet generated');
    res.json(report);
  } catch (err) {
    next(err);
  }
}

export async function getResults(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const run = await assertTestRunInOrg(req.params.id, orgId);
    const results = await prisma.testResult.findMany({
      where: { testRunId: run.id },
      include: { testCase: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json(results);
  } catch (err) {
    next(err);
  }
}
