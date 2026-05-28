import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';

export async function getStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;

    const [agentCount, testRuns, reports, recentRuns] = await Promise.all([
      prisma.agent.count({ where: { orgId } }),
      prisma.testRun.count({ where: { suite: { agent: { orgId } } } }),
      prisma.report.findMany({
        where: { testRun: { suite: { agent: { orgId } } } },
        select: { keyFindings: true },
      }),
      prisma.testRun.findMany({
        where: { suite: { agent: { orgId } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          suite: { include: { agent: { select: { id: true, name: true } } } },
          report: { select: { id: true, riskScore: true, overallRiskRating: true } },
        },
      }),
    ]);

    let critical = 0;
    let high = 0;
    let medium = 0;
    let low = 0;
    for (const r of reports) {
      const findings = (r.keyFindings as Array<{ severity: string }>) || [];
      for (const f of findings) {
        if (f.severity === 'critical') critical++;
        else if (f.severity === 'high') high++;
        else if (f.severity === 'medium') medium++;
        else if (f.severity === 'low') low++;
      }
    }

    res.json({
      totalAgents: agentCount,
      totalTestRuns: testRuns,
      criticalFindings: critical,
      severityBreakdown: { critical, high, medium, low },
      recentActivity: recentRuns.map((r) => ({
        testRunId: r.id,
        agentId: r.suite.agent.id,
        agentName: r.suite.agent.name,
        status: r.status,
        progress: r.progress,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
        reportId: r.report?.id ?? null,
        riskScore: r.report?.riskScore ?? null,
        overallRiskRating: r.report?.overallRiskRating ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
}
