import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { HttpError } from '../middleware/errorHandler';
import { enqueueTestRun } from '../queues/testRunQueue';
import { auditFromRequest } from '../lib/audit';
import { freshSeed } from '../lib/prng';

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

/**
 * Remediation Re-test. Clones ONLY the failed/partial test cases of a completed
 * run into a fresh suite and runs them again against the agent's current config,
 * so an operator can confirm a fix without re-running the whole (slow/expensive)
 * suite. The new run executes the pre-built cases as-is (cartesian, one pass
 * each — no adaptive escalation), and `skipSuiteGeneration` stops the worker
 * from regenerating the suite. The client compares the new results against the
 * parent's failures to show a "resolved X of Y" delta.
 */
export async function reverifyRun(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const parent = await assertTestRunInOrg(req.params.id, orgId);
    if (parent.status !== 'COMPLETED') {
      throw new HttpError(409, 'Only completed runs can be re-verified.');
    }

    const failed = await prisma.testResult.findMany({
      where: { testRunId: parent.id, result: { in: ['fail', 'partial'] } },
      include: { testCase: true },
      orderBy: { createdAt: 'asc' },
    });
    if (failed.length === 0) {
      throw new HttpError(400, 'This run has no failed or partial findings to re-verify.');
    }

    const agentId = parent.suite.agentId;
    const suite = await prisma.testSuite.create({ data: { agentId } });

    // Clone each previously-failing case (dedupe by case id).
    const seen = new Set<string>();
    const casesData = failed
      .filter((r) => (seen.has(r.testCaseId) ? false : (seen.add(r.testCaseId), true)))
      .map((r) => ({
        suiteId: suite.id,
        externalId: r.testCase.externalId,
        category: r.testCase.category,
        severity: r.testCase.severity,
        name: r.testCase.name,
        description: r.testCase.description,
        attackPrompt: r.testCase.attackPrompt,
        expectedSafeBehaviour: r.testCase.expectedSafeBehaviour,
        detectionCriteria: r.testCase.detectionCriteria,
        probeId: r.testCase.probeId,
        strategyChain: r.testCase.strategyChain,
      }));
    await prisma.testCase.createMany({ data: casesData });

    const run = await prisma.testRun.create({
      data: {
        suiteId: suite.id,
        status: 'PENDING',
        phase: 'preparing',
        phaseDetail: `Queued — re-verifying ${casesData.length} finding(s) from a prior run`,
        totalTests: casesData.length,
        engineVersion: 'v2',
        seed: freshSeed(),
        // cartesian = run each pre-built case once (no hybrid re-escalation).
        enumerationMode: 'cartesian',
      },
    });

    await enqueueTestRun({ testRunId: run.id, skipSuiteGeneration: true });
    await auditFromRequest(req, {
      action: 'run.reverify',
      targetType: 'test_run',
      targetId: run.id,
      metadata: { parentRunId: parent.id, agentId, cases: casesData.length },
    });

    res.status(202).json({ testRunId: run.id, parentRunId: parent.id, totalTests: casesData.length });
  } catch (err) {
    next(err);
  }
}
