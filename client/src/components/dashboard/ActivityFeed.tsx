import { Link } from 'react-router-dom';
import { CheckCircle2, Loader2, AlertCircle, Clock } from 'lucide-react';
import type { DashboardStats } from '@/types';
import { formatDate } from '@/lib/utils';
import { RiskScore } from '@/components/shared/RiskScore';

export function ActivityFeed({ items }: { items: DashboardStats['recentActivity'] }) {
  if (items.length === 0) {
    return <div className="py-6 text-center text-sm text-muted-foreground">No recent activity</div>;
  }
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => (
        <li key={item.testRunId} className="flex items-center justify-between gap-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <StatusIcon status={item.status} />
            <div className="min-w-0">
              <Link
                to={item.reportId ? `/reports/${item.reportId}` : `/agents/${item.agentId}`}
                className="block truncate text-sm font-medium text-foreground hover:text-indigo-600"
              >
                {item.agentName}
              </Link>
              <div className="text-xs text-muted-foreground">
                {item.status === 'COMPLETED' ? `Completed ${formatDate(item.completedAt)}` : `${item.status} · ${item.progress}%`}
              </div>
            </div>
          </div>
          {item.riskScore != null && <RiskScore score={item.riskScore} size="sm" showLabel={false} />}
        </li>
      ))}
    </ul>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'COMPLETED') return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
  if (status === 'RUNNING') return <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />;
  if (status === 'FAILED') return <AlertCircle className="h-5 w-5 text-red-500" />;
  return <Clock className="h-5 w-5 text-slate-400" />;
}
