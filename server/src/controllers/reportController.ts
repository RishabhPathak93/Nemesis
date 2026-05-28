import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../middleware/errorHandler';
import { writeAudit } from '../lib/audit';
import { logger } from '../lib/logger';

const reportInclude = Prisma.validator<Prisma.ReportInclude>()({
  testRun: {
    include: {
      suite: { include: { agent: true } },
      results: { include: { testCase: true } },
    },
  },
});

type ReportWithRelations = Prisma.ReportGetPayload<{ include: typeof reportInclude }>;

export async function listReports(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const reports = await prisma.report.findMany({
      where: { testRun: { suite: { agent: { orgId } } } },
      orderBy: { createdAt: 'desc' },
      include: {
        testRun: {
          include: { suite: { include: { agent: { select: { id: true, name: true } } } } },
        },
      },
    });

    res.json(
      reports.map((r) => {
        const findings = (r.keyFindings as Array<{ severity: string }>) || [];
        return {
          id: r.id,
          testRunId: r.testRunId,
          agentId: r.testRun.suite.agent.id,
          agentName: r.testRun.suite.agent.name,
          createdAt: r.createdAt,
          riskScore: r.riskScore,
          overallRiskRating: r.overallRiskRating,
          criticalFindings: findings.filter((f) => f.severity === 'critical').length,
          highFindings: findings.filter((f) => f.severity === 'high').length,
          shareToken: r.shareToken,
        };
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function getReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const report = await prisma.report.findUnique({
      where: { id: req.params.id },
      include: reportInclude,
    });
    if (!report || report.testRun.suite.agent.orgId !== orgId) {
      throw new HttpError(404, 'Report not found');
    }
    res.json(formatFullReport(report));
  } catch (err) {
    next(err);
  }
}

export async function getReportByShareToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const report = await prisma.report.findUnique({
      where: { shareToken: req.params.token },
      include: reportInclude,
    });
    if (!report) throw new HttpError(404, 'Report not found');
    if (!report.shareEnabled || report.shareRevokedAt) throw new HttpError(404, 'Report not found');
    if (report.shareExpiresAt && report.shareExpiresAt < new Date()) {
      throw new HttpError(404, 'Report not found');
    }

    // Best-effort: record the view + audit, never block the response.
    const ip = req.ip ?? null;
    const ua = typeof req.headers['user-agent'] === 'string' ? (req.headers['user-agent'] as string).slice(0, 500) : null;
    prisma.reportShareView
      .create({ data: { reportId: report.id, ip, userAgent: ua } })
      .catch((err) => logger.warn({ err }, 'reportShareView write failed'));
    writeAudit({
      orgId: report.testRun.suite.agent.orgId,
      actorId: null,
      actorType: 'share_link',
      action: 'report.share.viewed',
      targetType: 'report',
      targetId: report.id,
      ip,
      userAgent: ua,
      metadata: { requestId: req.id, token: report.shareToken.slice(0, 8) + '…' },
    }).catch(() => undefined);

    res.json(formatFullReport(report));
  } catch (err) {
    next(err);
  }
}

function formatFullReport(report: ReportWithRelations) {
  return {
    id: report.id,
    testRunId: report.testRunId,
    createdAt: report.createdAt,
    executiveSummary: report.executiveSummary,
    overallRiskRating: report.overallRiskRating,
    riskScore: report.riskScore,
    keyFindings: report.keyFindings,
    categoryBreakdown: report.categoryBreakdown,
    remediationRoadmap: report.remediationRoadmap,
    technicalNotes: report.technicalNotes,
    conclusion: report.conclusion,
    shareToken: report.shareToken,
    agent: {
      id: report.testRun.suite.agent.id,
      name: report.testRun.suite.agent.name,
      agentType: report.testRun.suite.agent.agentType,
      model: report.testRun.suite.agent.model,
    },
    testRun: {
      id: report.testRun.id,
      startedAt: report.testRun.startedAt,
      completedAt: report.testRun.completedAt,
      totalTests: report.testRun.totalTests,
    },
    results: report.testRun.results.map((r) => ({
      id: r.id,
      result: r.result,
      confidence: r.confidence,
      reasoning: r.reasoning,
      exploitationEvidence: r.exploitationEvidence,
      agentResponse: r.agentResponse,
      testCase: {
        externalId: r.testCase.externalId,
        category: r.testCase.category,
        severity: r.testCase.severity,
        name: r.testCase.name,
        description: r.testCase.description,
        attackPrompt: r.testCase.attackPrompt,
      },
    })),
  };
}
