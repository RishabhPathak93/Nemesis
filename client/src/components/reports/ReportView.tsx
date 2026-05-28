import { forwardRef } from 'react';
import type { FullReport } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { RiskScore } from '@/components/shared/RiskScore';
import { ReportOverviewTab } from './ReportOverviewTab';
import { ReportFindingsTab } from './ReportFindingsTab';
import { formatDate } from '@/lib/utils';

interface ReportViewProps {
  report: FullReport;
}

export const ReportView = forwardRef<HTMLDivElement, ReportViewProps>(({ report }, ref) => {
  return (
    <div ref={ref} className="space-y-4">
      {/* Sticky header */}
      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-6 pt-6">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Security audit · {report.testRun.id.slice(0, 12)}
            </div>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground">{report.agent.name}</h2>
            <div className="mt-1 text-sm text-muted-foreground">
              {report.agent.agentType} · {report.agent.model} · run completed {formatDate(report.testRun.completedAt || report.createdAt)}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="whitespace-nowrap"><b className="text-foreground tabular-nums">{report.testRun.totalTests}</b> tests</span>
              <span className="whitespace-nowrap"><b className="text-foreground tabular-nums">{report.results.filter((r) => r.result === 'fail').length}</b> failures</span>
              <span className="whitespace-nowrap"><b className="text-foreground tabular-nums">{report.results.filter((r) => r.result === 'partial').length}</b> partials</span>
            </div>
          </div>
          <div className="flex-shrink-0">
            <RiskScore score={report.riskScore} size="lg" />
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="findings">Findings ({report.results.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <ReportOverviewTab report={report} />
        </TabsContent>
        <TabsContent value="findings" className="mt-4">
          <ReportFindingsTab report={report} />
        </TabsContent>
      </Tabs>
    </div>
  );
});
ReportView.displayName = 'ReportView';
