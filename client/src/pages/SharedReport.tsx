import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiError } from '@/lib/api';
import type { FullReport } from '@/types';
import { ReportView } from '@/components/reports/ReportView';
import { Button } from '@/components/ui/button';
import { FullPageLoader } from '@/components/shared/LoadingSpinner';
import { downloadReportPdf } from '@/lib/pdf';

export default function SharedReport() {
  const { token } = useParams<{ token: string }>();
  const [report, setReport] = useState<FullReport | null>(null);

  useEffect(() => {
    if (!token) return;
    api
      .get<FullReport>(`/reports/share/${token}`)
      .then((r) => setReport(r.data))
      .catch((err) => toast.error(apiError(err)));
  }, [token]);

  if (!report) return <FullPageLoader />;

  return (
    <div className="min-h-full bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <img src="/logos/reticle.svg" alt="" className="h-8 w-8" />
            <div>
              <div className="text-base font-bold tracking-tight text-foreground">Nemesis AI</div>
              <div className="text-xs text-muted-foreground">Shared security audit report</div>
            </div>
          </div>
          <Button variant="outline" onClick={() => downloadReportPdf(report)}>
            <Download className="h-4 w-4" /> Download PDF
          </Button>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-6 py-8">
        <ReportView report={report} />
      </div>
    </div>
  );
}
