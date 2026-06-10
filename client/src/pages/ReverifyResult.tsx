import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { ShieldCheck, ShieldAlert, ArrowLeft, RefreshCw } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SeverityBadge } from '@/components/shared/SeverityBadge';
import { FullPageLoader } from '@/components/shared/LoadingSpinner';
import { ErrorState } from '@/components/shared/ErrorState';

interface Result {
  result: 'pass' | 'fail' | 'partial' | 'error' | string;
  testCase: { externalId: string; name: string; severity: string; category: string };
}
interface Status { status: string; progress: number; totalTests: number; }

/**
 * Remediation Re-test result. Polls the verification run, then diffs its
 * outcomes against the parent run's failed/partial findings to show which are
 * now resolved vs still failing.
 */
export default function ReverifyResult() {
  const { runId } = useParams<{ runId: string }>();
  const [params] = useSearchParams();
  const parentId = params.get('parent') || '';
  const navigate = useNavigate();

  const [status, setStatus] = useState<Status | null>(null);
  const [verResults, setVerResults] = useState<Result[] | null>(null);
  const [parentResults, setParentResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const finish = useCallback(async () => {
    try {
      const [ver, par] = await Promise.all([
        api.get<Result[]>(`/test-runs/${runId}/results`),
        api.get<Result[]>(`/test-runs/${parentId}/results`),
      ]);
      setVerResults(ver.data);
      setParentResults(par.data);
    } catch (err) {
      setError(apiError(err));
    }
  }, [runId, parentId]);

  const poll = useCallback(() => {
    if (!runId) return;
    api
      .get<Status>(`/test-runs/${runId}/status`)
      .then((r) => {
        setStatus(r.data);
        if (r.data.status === 'COMPLETED') void finish();
        else if (r.data.status === 'FAILED') setError('The re-verification run failed.');
        else timer.current = setTimeout(poll, 3000);
      })
      .catch((err) => setError(apiError(err)));
  }, [runId, finish]);

  useEffect(() => {
    poll();
    return () => clearTimeout(timer.current);
  }, [poll]);

  if (error) return <ErrorState message={error} full />;
  if (!status) return <FullPageLoader />;

  // Still running.
  if (status.status !== 'COMPLETED' || !verResults || !parentResults) {
    return (
      <>
        <PageHeader title="Re-verifying findings" description="Re-running the previously-failed test cases against the agent…" />
        <Card className="p-8 text-center">
          <RefreshCw className="mx-auto mb-3 h-6 w-6 animate-spin text-indigo-500" />
          <div className="text-sm text-muted-foreground">
            {status.progress}% · {status.totalTests} finding(s) under re-test
          </div>
        </Card>
      </>
    );
  }

  // Diff by externalId.
  const verByExt = new Map(verResults.map((r) => [r.testCase.externalId, r]));
  const priorFailed = parentResults.filter((r) => r.result === 'fail' || r.result === 'partial');
  const resolved = priorFailed.filter((p) => verByExt.get(p.testCase.externalId)?.result === 'pass');
  const persistent = priorFailed.filter((p) => {
    const v = verByExt.get(p.testCase.externalId)?.result;
    return v === 'fail' || v === 'partial';
  });
  const total = priorFailed.length;
  const pct = total ? Math.round((resolved.length / total) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Remediation re-test"
        description="Outcome of re-running the previously-failed findings against the agent's current configuration."
        actions={
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        }
      />

      <Card className="mb-4 p-6">
        <div className="flex items-center gap-4">
          <div className={`flex h-14 w-14 items-center justify-center rounded-xl ${resolved.length === total ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'}`}>
            {resolved.length === total ? <ShieldCheck className="h-7 w-7" /> : <ShieldAlert className="h-7 w-7" />}
          </div>
          <div>
            <div className="text-2xl font-bold text-foreground">Resolved {resolved.length} of {total} findings</div>
            <div className="text-sm text-muted-foreground">{pct}% of previously-failing test cases now pass · {persistent.length} still failing</div>
          </div>
        </div>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            <ShieldCheck className="h-4 w-4" /> Resolved ({resolved.length})
          </div>
          {resolved.length === 0 ? (
            <p className="text-sm text-muted-foreground">None resolved yet.</p>
          ) : (
            <ul className="space-y-2">
              {resolved.map((r) => (
                <li key={r.testCase.externalId} className="flex items-center gap-2 text-sm">
                  <SeverityBadge severity={r.testCase.severity} />
                  <span className="text-foreground">{r.testCase.name}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-400">
            <ShieldAlert className="h-4 w-4" /> Still failing ({persistent.length})
          </div>
          {persistent.length === 0 ? (
            <p className="text-sm text-muted-foreground">Everything passed — nice work.</p>
          ) : (
            <ul className="space-y-2">
              {persistent.map((r) => (
                <li key={r.testCase.externalId} className="flex items-center gap-2 text-sm">
                  <SeverityBadge severity={r.testCase.severity} />
                  <span className="text-foreground">{r.testCase.name}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
