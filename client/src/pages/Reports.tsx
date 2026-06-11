import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiError } from '@/lib/api';
import type { ReportListItem } from '@/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { EmptyState } from '@/components/shared/EmptyState';
import { FullPageLoader } from '@/components/shared/LoadingSpinner';
import { SeverityBadge } from '@/components/shared/SeverityBadge';
import { formatDate } from '@/lib/utils';

function riskScoreTone(score: number): string {
  if (score >= 75) return 'text-red-700 dark:text-red-300';
  if (score >= 50) return 'text-orange-700 dark:text-orange-300';
  if (score >= 25) return 'text-amber-700 dark:text-amber-300';
  return 'text-emerald-700 dark:text-emerald-300';
}

export default function Reports() {
  const [reports, setReports] = useState<ReportListItem[] | null>(null);
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<string>('all');

  useEffect(() => {
    api
      .get<ReportListItem[]>('/reports')
      .then((r) => setReports(r.data))
      .catch((err) => toast.error(apiError(err)));
  }, []);

  const filtered = useMemo(() => {
    if (!reports) return [];
    return reports.filter((r) => {
      if (riskFilter !== 'all' && r.overallRiskRating.toLowerCase() !== riskFilter) return false;
      if (search && !r.agentName.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [reports, search, riskFilter]);

  if (reports == null) return <FullPageLoader />;

  return (
    <>
      <PageHeader title="Reports" description="All security audit reports across your connected agents." />

      {reports.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-7 w-7" />}
          title="No reports yet"
          description="Run a security test on an agent to generate your first report."
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <Input
              placeholder="Filter by agent name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select value={riskFilter} onValueChange={setRiskFilter}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All risk levels</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Risk rating</TableHead>
                  <TableHead className="text-right" title="Composite risk score (0–100; higher = riskier)">Risk score</TableHead>
                  <TableHead className="text-right" title="Number of critical-severity findings">Critical</TableHead>
                  <TableHead className="text-right" title="Number of high-severity findings">High</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link to={`/reports/${r.id}`} className="font-medium text-foreground hover:text-indigo-600 dark:text-indigo-400">
                        {r.agentName}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDate(r.createdAt)}</TableCell>
                    <TableCell><SeverityBadge severity={r.overallRiskRating} /></TableCell>
                    <TableCell className={`text-right font-semibold tabular-nums ${riskScoreTone(r.riskScore)}`}>{r.riskScore}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.criticalFindings}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.highFindings}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}
