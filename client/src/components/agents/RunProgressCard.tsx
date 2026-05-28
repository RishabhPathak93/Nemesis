import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import type { TestRunStatus } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface Props {
  testRunId: string;
  onComplete?: () => void;
}

const PHASE_TITLE: Record<string, string> = {
  preparing: 'Generating tailored test suite',
  executing: 'Running adversarial tests',
  reporting: 'Generating audit report',
};

function statusLabel(s: TestRunStatus): { title: string; subtitle: string } {
  if (s.status === 'COMPLETED') {
    return { title: 'Run complete', subtitle: `${s.totalTests} tests executed.` };
  }
  if (s.status === 'FAILED') {
    return { title: 'Run failed', subtitle: s.errorMessage || 'See server logs for detail.' };
  }
  if (s.status === 'PENDING') {
    return { title: 'Queued', subtitle: 'Waiting for the worker to pick up the job…' };
  }
  // RUNNING
  if (s.phase === 'executing') {
    return {
      title: PHASE_TITLE.executing,
      subtitle: s.phaseDetail || `Test ${Math.min(s.progress, 100)}% complete`,
    };
  }
  if (s.phase === 'preparing') {
    return {
      title: PHASE_TITLE.preparing,
      subtitle: s.phaseDetail || 'Asking the LLM to generate test cases…',
    };
  }
  if (s.phase === 'reporting') {
    return { title: PHASE_TITLE.reporting, subtitle: s.phaseDetail || 'Synthesising findings…' };
  }
  return { title: 'Running', subtitle: s.phaseDetail || '' };
}

function isPhaseProgressIndeterminate(s: TestRunStatus): boolean {
  return s.status === 'RUNNING' && (s.phase === 'preparing' || s.phase === 'reporting');
}

export function RunProgressCard({ testRunId, onComplete }: Props) {
  const [status, setStatus] = useState<TestRunStatus | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const { data } = await api.get<TestRunStatus>(`/test-runs/${testRunId}/status`);
        if (cancelled) return;
        setStatus(data);
        if (data.status === 'COMPLETED') {
          // Fetch report id (may not be ready immediately)
          try {
            const r = await api.get(`/test-runs/${testRunId}/report`);
            if (!cancelled) setReportId(r.data.id);
          } catch {
            setTimeout(async () => {
              try {
                const r = await api.get(`/test-runs/${testRunId}/report`);
                if (!cancelled) setReportId(r.data.id);
              } catch {
                /* ignore */
              }
            }, 2000);
          }
          onComplete?.();
          return;
        }
        if (data.status === 'FAILED') {
          toast.error(`Test run failed: ${data.errorMessage || 'unknown error'}`);
          return;
        }
        timer = setTimeout(poll, 3000);
      } catch (err) {
        toast.error(apiError(err));
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testRunId]);

  if (!status) return null;

  const { title, subtitle } = statusLabel(status);
  const indeterminate = isPhaseProgressIndeterminate(status);

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            {status.status === 'COMPLETED' ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
            ) : status.status === 'FAILED' ? (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
            ) : (
              <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-indigo-500" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">{title}</div>
              <div className="text-xs text-muted-foreground">{subtitle}</div>
            </div>
          </div>
          {status.status === 'COMPLETED' && reportId && (
            <Button asChild size="sm">
              <Link to={`/reports/${reportId}`}>View report</Link>
            </Button>
          )}
          {(status.status === 'RUNNING' || status.status === 'PENDING') && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                if (!confirm('Cancel this test run? In-flight cases finish, then the run is marked failed.')) return;
                try {
                  await api.post(`/test-runs/${testRunId}/cancel`);
                  toast.success('Cancellation requested');
                } catch (err) {
                  toast.error(apiError(err));
                }
              }}
            >
              <X className="mr-1 h-4 w-4" /> Cancel
            </Button>
          )}
        </div>

        {/* Phase indicator pills */}
        {status.status === 'RUNNING' && (
          <div className="flex gap-1">
            <PhasePill active={status.phase === 'preparing'} done={status.phase === 'executing' || status.phase === 'reporting'} label="Prepare" />
            <PhasePill active={status.phase === 'executing'} done={status.phase === 'reporting'} label="Execute" />
            <PhasePill active={status.phase === 'reporting'} done={false} label="Report" />
          </div>
        )}

        {/* Progress bar — indeterminate during prepare/report, percent during execute */}
        {indeterminate ? (
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div className="absolute inset-y-0 w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-indigo-500" />
            <style>{`@keyframes indeterminate { 0% { left: -33%; } 100% { left: 100%; } }`}</style>
          </div>
        ) : (
          <Progress value={status.progress} />
        )}

        {/* Test execution summary */}
        {(status.status === 'RUNNING' && status.phase === 'executing') || status.status === 'COMPLETED' ? (
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span><span className="font-semibold text-emerald-600">{status.summary.pass}</span> pass</span>
            <span><span className="font-semibold text-red-600">{status.summary.fail}</span> fail</span>
            <span><span className="font-semibold text-yellow-600">{status.summary.partial}</span> partial</span>
            <span><span className="font-semibold text-muted-foreground">{status.summary.error}</span> error</span>
            <span className="ml-auto">Total: {status.totalTests}</span>
          </div>
        ) : null}

        {/* Helpful hint when prepare is taking a while */}
        {status.status === 'RUNNING' && status.phase === 'preparing' && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
            Suite generation calls your configured LLM. If you're using a local reasoning model
            (e.g. <code>deepseek-r1</code>) on CPU, this can take several minutes.
            For faster runs use <code>qwen2.5:7b</code>, <code>llama3.1:8b</code>, or <code>mistral:7b</code>.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PhasePill({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  const cls = active
    ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200'
    : done
      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
      : 'bg-slate-50 text-muted-foreground ring-1 ring-slate-200';
  return <span className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}>{label}</span>;
}
