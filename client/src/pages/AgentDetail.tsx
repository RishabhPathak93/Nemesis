import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, Play, RefreshCw, Trash2, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiError } from '@/lib/api';
import type { Agent, TestRunSummary, TestSuiteSummary } from '@/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { FullPageLoader } from '@/components/shared/LoadingSpinner';
import { ErrorState } from '@/components/shared/ErrorState';
import { RiskScore } from '@/components/shared/RiskScore';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { RunProgressCard } from '@/components/agents/RunProgressCard';
import { formatDate } from '@/lib/utils';

interface AgentWithSuites extends Agent {
  testSuites: Array<TestSuiteSummary & { testRuns: TestRunSummary[]; _count: { testCases: number } }>;
}

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<AgentWithSuites | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [verticalPacks, setVerticalPacks] = useState<{ slug: string; title: string }[]>([]);
  const [searchParams] = useSearchParams();
  const [verticalPackSlug, setVerticalPackSlug] = useState<string>(searchParams.get('verticalPack') ?? 'auto');

  async function load() {
    if (!id) return;
    setLoadError(null);
    try {
      const { data } = await api.get<AgentWithSuites>(`/agents/${id}`);
      setAgent(data);
    } catch (err) {
      const msg = apiError(err);
      setLoadError(msg);
      toast.error(msg);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    void api
      .get<{ verticals: { slug: string; title: string }[] }>('/security-engine/verticals')
      .then((r) => setVerticalPacks(r.data.verticals))
      .catch(() => { /* non-fatal — picker just shows "Auto" */ });
  }, []);

  if (loadError) return <ErrorState message={loadError} onRetry={() => void load()} full />;
  if (!agent) return <FullPageLoader />;

  async function refreshUnderstanding() {
    setBusy(true);
    try {
      await api.post(`/agents/${id}/understand`);
      toast.success('Understanding refreshed');
      await load();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function runTests() {
    setBusy(true);
    try {
      // v2.2 — Hybrid is the only mode. The server enumerates the Cartesian
      // skeleton and the LLM mutates each payload against the agent's response,
      // escalating chain depth until exploit or budget exhaustion.
      const body: Record<string, unknown> = {};
      if (verticalPackSlug !== 'auto') body.verticalPackSlug = verticalPackSlug;
      const { data } = await api.post<{ testRunId: string }>(`/agents/${id}/run-tests`, body);
      const scope = verticalPackSlug !== 'auto' ? ` — pack: ${verticalPackSlug}` : '';
      toast.success(`Security test started${scope}`);
      setActiveRunId(data.testRunId);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteAgent() {
    if (!confirm(`Delete agent "${agent!.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/agents/${id}`);
      toast.success('Agent deleted');
      navigate('/agents');
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  // Latest run across all suites (could be running, failed, or completed-with-report).
  const allRuns = (agent.testSuites ?? []).flatMap((s) => s.testRuns ?? []);
  allRuns.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const lastRun = allRuns[0];
  // Latest run that produced a report — preferred for the "View report" CTA.
  const lastReportedRun = allRuns.find((r) => !!r.report);

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            {agent.name}
            {agent.riskScore != null && <RiskScore score={agent.riskScore} size="sm" showLabel={false} />}
          </span>
        }
        description={`${agent.agentType} · ${agent.model}`}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate('/agents')}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button variant="outline" disabled={busy} onClick={refreshUnderstanding}>
              <RefreshCw className="h-4 w-4" /> Refresh understanding
            </Button>
            <Select value={verticalPackSlug} onValueChange={setVerticalPackSlug}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Auto — best fit" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto — best fit</SelectItem>
                {verticalPacks.map((p) => <SelectItem key={p.slug} value={p.slug}>{p.title}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              disabled={busy}
              onClick={() => void runTests()}
              title="Hybrid scan — Cartesian skeleton enumeration with adaptive LLM mutation per response."
            >
              <Play className="h-4 w-4" /> Run security test
            </Button>
            <Button variant="destructive" onClick={deleteAgent}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </>
        }
      />

      {activeRunId && (
        <div className="mb-4">
          <RunProgressCard testRunId={activeRunId} onComplete={load} />
        </div>
      )}

      <div className="mb-4 grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Field label="Endpoint">{agent.endpointUrl}</Field>
            <Field label="API key (masked)">{agent.apiKey}</Field>
            <Field label="Response path">{agent.responsePath}</Field>
            <Field label="User access">{agent.userAccessLevel}</Field>
            <Field label="Sensitive data">
              {agent.sensitiveDataScope.length === 0
                ? <span className="text-muted-foreground">None</span>
                : agent.sensitiveDataScope.map((s) => <Badge key={s} variant="secondary" className="mr-1">{s}</Badge>)}
            </Field>
            {agent.statedPurpose && <Field label="Stated purpose">{agent.statedPurpose}</Field>}
            {agent.knownGuardrails && <Field label="Guardrails">{agent.knownGuardrails}</Field>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Last run</CardTitle></CardHeader>
          <CardContent className="flex flex-col items-center text-center">
            {lastRun ? (
              <>
                {lastReportedRun?.report ? (
                  <RiskScore score={lastReportedRun.report.riskScore} size="md" />
                ) : (
                  <Badge variant={lastRun.status === 'FAILED' ? 'destructive' : lastRun.status === 'RUNNING' ? 'warning' : 'secondary'}>
                    {lastRun.status}
                  </Badge>
                )}
                <div className="mt-3 text-xs text-muted-foreground">
                  {lastRun.status === 'RUNNING'
                    ? `Started ${formatDate(lastRun.startedAt || lastRun.createdAt)}`
                    : `Run on ${formatDate(lastRun.completedAt || lastRun.createdAt)}`}
                </div>
                {lastReportedRun?.report && (
                  <Button asChild variant="outline" className="mt-3" size="sm">
                    <Link to={`/reports/${lastReportedRun.report.id}`}>
                      <FileText className="h-4 w-4" /> View report
                    </Link>
                  </Button>
                )}
                {lastReportedRun && lastReportedRun !== lastRun && (
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    Showing report from {formatDate(lastReportedRun.completedAt || lastReportedRun.createdAt)}
                  </div>
                )}
              </>
            ) : (
              <div className="py-6 text-sm text-muted-foreground">No tests run yet</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="history">Test History</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardHeader><CardTitle>Security understanding</CardTitle></CardHeader>
            <CardContent>
              {agent.understanding ? (
                <div className="space-y-4 text-sm">
                  <div>
                    <div className="font-semibold text-foreground">Summary</div>
                    <p className="mt-1 text-muted-foreground">{agent.understanding.summary}</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <ListBlock title="Attack surfaces" items={agent.understanding.attack_surfaces} />
                    <ListBlock title="Recommended focus areas" items={agent.understanding.recommended_focus_areas} />
                  </div>
                  <div>
                    <div className="font-semibold text-foreground">Risk categories</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {agent.understanding.risk_categories.map((c) => (
                        <Badge key={c} variant="outline" className="font-mono text-[10px]">{c}</Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold text-foreground">Risk rationale</div>
                    <p className="mt-1 text-muted-foreground">{agent.understanding.risk_rationale}</p>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Generating security understanding…<br />
                  <Button variant="outline" className="mt-3" onClick={refreshUnderstanding}>Refresh now</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tests</TableHead>
                  <TableHead className="text-right">Risk score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(agent.testSuites || []).flatMap((s) =>
                  s.testRuns.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{formatDate(r.startedAt || r.createdAt)}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === 'COMPLETED' ? 'success' : r.status === 'FAILED' ? 'destructive' : 'secondary'}>
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{r.totalTests}</TableCell>
                      <TableCell className="text-right">
                        {r.report ? r.report.riskScore : '—'}
                      </TableCell>
                    </TableRow>
                  )),
                )}
                {agent.testSuites?.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground">No test runs yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="reports">
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Risk rating</TableHead>
                  <TableHead className="text-right">Risk score</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(agent.testSuites || []).flatMap((s) =>
                  s.testRuns.filter((r) => r.report).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{formatDate(r.completedAt || r.createdAt)}</TableCell>
                      <TableCell><Badge variant="outline">{r.report!.overallRiskRating}</Badge></TableCell>
                      <TableCell className="text-right">{r.report!.riskScore}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/reports/${r.report!.id}`}>Open</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  )),
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card>
            <CardHeader><CardTitle>Agent settings</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">Created {formatDate(agent.createdAt)}</p>
              <div className="border-t border-border pt-3">
                <div className="text-sm font-medium text-foreground">Danger zone</div>
                <p className="mt-1 text-xs text-muted-foreground">Deleting the agent removes its profile, history, and reports.</p>
                <Button variant="destructive" className="mt-3" onClick={deleteAgent}>
                  <Trash2 className="h-4 w-4" /> Delete agent
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] items-start gap-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-foreground break-all">{children}</div>
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="font-semibold text-foreground">{title}</div>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
        {items.map((it) => <li key={it}>{it}</li>)}
      </ul>
    </div>
  );
}
