import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, FlaskConical, AlertTriangle, Plus, FileText } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import type { DashboardStats } from '@/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { SeverityDonut } from '@/components/dashboard/SeverityDonut';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { FullPageLoader } from '@/components/shared/LoadingSpinner';
import { toast } from 'sonner';

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<DashboardStats>('/dashboard/stats')
      .then((r) => setStats(r.data))
      .catch((err) => toast.error(apiError(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !stats) return <FullPageLoader />;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Overview of your AI agents' security posture."
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/reports">
                <FileText className="h-4 w-4" /> View Reports
              </Link>
            </Button>
            <Button asChild>
              <Link to="/agents/new">
                <Plus className="h-4 w-4" /> Connect New Agent
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatsCard label="Total agents" value={stats.totalAgents} icon={<Bot className="h-5 w-5" />} />
        <StatsCard
          label="Total tests run"
          value={stats.totalTestRuns}
          icon={<FlaskConical className="h-5 w-5" />}
          accent="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
        />
        <StatsCard
          label="Critical findings"
          value={stats.criticalFindings}
          icon={<AlertTriangle className="h-5 w-5" />}
          accent="bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityFeed items={stats.recentActivity} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Findings by severity</CardTitle>
          </CardHeader>
          <CardContent>
            <SeverityDonut data={stats.severityBreakdown} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
