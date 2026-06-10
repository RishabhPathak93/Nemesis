import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Share2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiError } from '@/lib/api';
import type { FullReport } from '@/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { ReportView } from '@/components/reports/ReportView';
import { ShareControls } from '@/components/reports/ShareControls';
import { FullPageLoader } from '@/components/shared/LoadingSpinner';
import { ErrorState } from '@/components/shared/ErrorState';
import { downloadReportPdf } from '@/lib/pdf';

export default function ReportDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<FullReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    if (!id) return;
    setError(null);
    api
      .get<FullReport>(`/reports/${id}`)
      .then((r) => setReport(r.data))
      .catch((err) => {
        const msg = apiError(err);
        setError(msg);
        toast.error(msg);
      });
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} full />;
  if (!report) return <FullPageLoader />;

  function copyShareLink() {
    if (!report) return;
    const url = `${window.location.origin}/share/${report.shareToken}`;
    void navigator.clipboard.writeText(url);
    toast.success('Share link copied to clipboard');
  }

  const hasFindings = report.results.some((r) => r.result === 'fail' || r.result === 'partial');
  async function reverify() {
    if (!report) return;
    try {
      const { data } = await api.post<{ testRunId: string; totalTests: number }>(
        `/test-runs/${report.testRunId}/reverify`,
        {},
      );
      toast.success(`Re-verifying ${data.totalTests} finding(s)…`);
      navigate(`/reverify/${data.testRunId}?parent=${report.testRunId}`);
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  return (
    <>
      <PageHeader
        title="Security audit report"
        description={`Report for ${report.agent.name}`}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button variant="outline" onClick={copyShareLink}>
              <Share2 className="h-4 w-4" /> Share report
            </Button>
            {hasFindings && (
              <Button variant="outline" onClick={reverify} title="Re-run only the failed findings to confirm a fix">
                <ShieldCheck className="h-4 w-4" /> Re-verify findings
              </Button>
            )}
            <Button onClick={() => downloadReportPdf(report)}>
              <Download className="h-4 w-4" /> Download PDF
            </Button>
          </>
        }
      />
      <ShareControls report={report} onChange={(next) => setReport({ ...report, shareToken: next.shareToken })} />
      <ReportView ref={printRef} report={report} />
    </>
  );
}
